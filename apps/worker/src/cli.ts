#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { stdin, stdout } from "node:process"
import { createInterface } from "node:readline/promises"
import { fileURLToPath } from "node:url"
import { RunController, type RuntimeAdapter } from "@visual-scraper/core"
import type { ExtractionObservation } from "@visual-scraper/dom"
import { exportCsv, exportJson, exportXlsx } from "@visual-scraper/export"
import {
  extractedRecordSchema,
  type ScraperDefinition,
  scraperDefinitionSchema,
} from "@visual-scraper/schema"
import { PlaywrightCrawler } from "crawlee"
import { chromium, type Page } from "playwright"
import { WorkerRepository } from "./storage.js"

type BrowserRuntime = {
  extractPage(definition: ScraperDefinition): ExtractionObservation
  executeNavigation(
    action: ScraperDefinition["navigation"]["candidateActions"][number],
    document: Document,
    allowedOrigins: string[],
  ): boolean
}

const runtimePath = fileURLToPath(new URL("./dom-runtime.js", import.meta.url))
const dataRoot = resolve(process.cwd(), "worker-data")
const profileRoot = resolve(process.cwd(), "browser-profiles")

function option(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function profilePath(name: string): string {
  if (!/^[a-zA-Z0-9_-]{1,50}$/.test(name))
    throw new Error("Profile name must use letters, numbers, _ or -")
  mkdirSync(profileRoot, { recursive: true })
  return resolve(profileRoot, name)
}

async function ensureRuntime(page: Page): Promise<void> {
  let ready = false
  try {
    ready = await page.evaluate(() =>
      Boolean(
        (
          window as typeof window & {
            __visualScraperRuntime?: BrowserRuntime
          }
        ).__visualScraperRuntime,
      ),
    )
  } catch {
    /* Navigation may be in progress. */
  }
  if (!ready) await page.addScriptTag({ path: runtimePath })
}

function adapter(page: Page, definition: ScraperDefinition): RuntimeAdapter {
  return {
    async observe(definition) {
      await ensureRuntime(page)
      const result = await page.evaluate(
        (value) =>
          (
            window as typeof window & { __visualScraperRuntime: BrowserRuntime }
          ).__visualScraperRuntime.extractPage(value),
        definition,
      )
      if (!result || typeof result !== "object")
        throw new Error("Browser runtime returned no observation")
      const observation = result as ExtractionObservation
      return {
        url: observation.url,
        records: observation.records.map((item) => extractedRecordSchema.parse(item)),
        navigation: observation.navigation,
        stateSignature: observation.stateSignature,
        healedFields: observation.healedFields,
        healedRecords: observation.healedRecords,
        healingEvents: observation.healingEvents,
      }
    },
    async navigate(action) {
      await ensureRuntime(page)
      const previousUrl = page.url()
      try {
        return await page.evaluate(
          (value) =>
            (
              window as typeof window & { __visualScraperRuntime: BrowserRuntime }
            ).__visualScraperRuntime.executeNavigation(
              value.action,
              document,
              value.allowedOrigins,
            ),
          { action, allowedOrigins: definition.scope.allowedOrigins },
        )
      } catch {
        return page.url() !== previousUrl
      }
    },
    async waitForChange(previousSignature, timeoutMs) {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        try {
          await ensureRuntime(page)
          const current = await page.evaluate((value) => {
            const runtime = (window as typeof window & { __visualScraperRuntime: BrowserRuntime })
              .__visualScraperRuntime
            return runtime.extractPage(value)
          }, definition)
          if (current.stateSignature && current.stateSignature !== previousSignature) return true
        } catch {
          /* Try after navigation settles. */
        }
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      return false
    },
  }
}

function readDefinition(path: string): ScraperDefinition {
  return scraperDefinitionSchema.parse(JSON.parse(readFileSync(resolve(path), "utf8")))
}

async function login(): Promise<void> {
  const profileName = option("profile") ?? "default"
  const url = option("url")
  if (!url || !/^https?:\/\//.test(url)) throw new Error("Provide --url with an HTTP(S) website")
  const context = await chromium.launchPersistentContext(profilePath(profileName), {
    headless: false,
  })
  const page = context.pages()[0] ?? (await context.newPage())
  await page.goto(url)
  const prompt = createInterface({ input: stdin, output: stdout })
  try {
    await prompt.question("Sign in using the browser, then press Enter here to save the profile. ")
  } finally {
    prompt.close()
    await context.close()
  }
}

async function run(
  definition: ScraperDefinition,
  profileName: string,
  outputDir: string,
  existingRunId?: string,
): Promise<void> {
  mkdirSync(outputDir, { recursive: true })
  const repository = new WorkerRepository(resolve(outputDir, "runs.sqlite"))
  const runId = existingRunId ?? crypto.randomUUID()
  repository.saveRun(runId, definition, profileName)
  const checkpoint = await repository.loadCheckpoint(runId)
  const urls = checkpoint ? [checkpoint.currentUrl] : definition.scope.startUrls
  console.log(`Run ID: ${runId}`)
  const crawler = new PlaywrightCrawler({
    maxConcurrency: 1,
    maxRequestsPerCrawl: urls.length,
    maxRequestRetries: 2,
    requestHandlerTimeoutSecs: Math.ceil(definition.navigation.maxRuntimeMs / 1000) + 120,
    launchContext: {
      launcher: chromium,
      userDataDir: profilePath(profileName),
      useIncognitoPages: false,
    },
    async requestHandler({ page }) {
      await ensureRuntime(page)
      const controller = new RunController(adapter(page, definition), repository, definition, {
        onEvent(event) {
          console.log(JSON.stringify(event))
        },
      })
      const result = await controller.run(runId)
      console.log(
        `Run ${runId}: ${result.state}, ${result.recordCount} records, ${result.stopReason ?? ""}`,
      )
    },
    async failedRequestHandler({ request, error }) {
      console.error(
        `Failed ${request.url}: ${error instanceof Error ? error.message : String(error)}`,
      )
    },
  })
  try {
    await crawler.run(urls)
  } finally {
    repository.close()
  }
}

async function exportRun(runId: string, outputDir: string, format: string): Promise<void> {
  const repository = new WorkerRepository(resolve(outputDir, "runs.sqlite"))
  try {
    const definition = repository.getRun(runId)?.definition
    if (!definition) throw new Error("Run not found")
    const records = await repository.listRecords(runId)
    const output = resolve(outputDir, `${runId}.${format}`)
    if (format === "json") writeFileSync(output, exportJson(definition, records))
    else if (format === "csv") writeFileSync(output, exportCsv(definition, records))
    else if (format === "xlsx")
      writeFileSync(output, Buffer.from(await exportXlsx(definition, records)))
    else throw new Error("Format must be json, csv, or xlsx")
    console.log(output)
  } finally {
    repository.close()
  }
}

async function main(): Promise<void> {
  const command = process.argv[2]
  const argument = process.argv[3]
  const outputDir = resolve(option("output") ?? dataRoot)
  if (command === "validate" && argument) {
    const definition = readDefinition(argument)
    console.log(`Valid v${definition.version} definition: ${definition.metadata.name}`)
  } else if (command === "login") await login()
  else if (command === "run" && argument)
    await run(readDefinition(argument), option("profile") ?? "default", outputDir)
  else if (command === "resume" && argument) {
    const repository = new WorkerRepository(resolve(outputDir, "runs.sqlite"))
    const saved = repository.getRun(argument)
    repository.close()
    if (!saved) throw new Error("Run not found")
    await run(saved.definition, saved.profileName, outputDir, argument)
  } else if (command === "export" && argument) {
    await exportRun(argument, outputDir, option("format") ?? "csv")
  } else {
    console.log(
      "Usage: scraper validate <definition> | login --profile NAME --url URL | run <definition> [--profile NAME] [--output DIR] | resume <run-id> [--output DIR] | export <run-id> --format json|csv|xlsx [--output DIR]",
    )
    process.exitCode = 1
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
