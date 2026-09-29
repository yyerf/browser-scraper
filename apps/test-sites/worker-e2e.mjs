import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { chromium } from "@playwright/test"
import { createServer } from "vite"

const root = resolve(import.meta.dirname, "../..")
const cli = resolve(root, "apps/worker/dist/cli.js")
const runtime = resolve(root, "apps/worker/dist/dom-runtime.js")
const directory = await mkdtemp(join(tmpdir(), "visual-scraper-worker-"))

async function command(args) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: directory,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let output = ""
    child.stdout.on("data", (chunk) => {
      output += chunk.toString()
    })
    child.stderr.on("data", (chunk) => {
      output += chunk.toString()
    })
    child.on("error", reject)
    child.on("exit", (code) => (code === 0 ? resolveCommand(output) : reject(new Error(output))))
  })
}

let browser
let fixtureServer
try {
  try {
    await fetch("http://127.0.0.1:4173/?mode=static")
  } catch {
    fixtureServer = await createServer({
      root: resolve("apps/test-sites"),
      server: { host: "127.0.0.1", port: 4173, strictPort: true },
    })
    await fixtureServer.listen()
  }
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.goto("http://127.0.0.1:4173/?mode=next&page=1")
  await page.addScriptTag({ path: runtime })
  const definition = await page.evaluate(() => {
    const first = document.querySelector("article")
    const fields = [
      { name: "Name", element: first.querySelector("h2") },
      { name: "Price", element: first.querySelector(".price") },
      { name: "Rating", element: first.querySelector(".rating") },
      { name: "Image", element: first.querySelector("img") },
    ]
    return window.__visualScraperRuntime.buildDefinition(fields, "Worker fixture", location.href)
  })
  await browser.close()
  browser = undefined
  const definitionPath = join(directory, "definition.json")
  await writeFile(definitionPath, JSON.stringify(definition))
  await command(["validate", definitionPath])
  const output = await command([
    "run",
    definitionPath,
    "--output",
    directory,
    "--profile",
    "fixture",
  ])
  const runId = output.match(/Run ID: ([a-f0-9-]+)/)?.[1]
  if (!runId || !output.includes("60 records")) throw new Error(`Worker run failed:\n${output}`)
  await command(["export", runId, "--format", "json", "--output", directory])
  const records = JSON.parse(await readFile(join(directory, `${runId}.json`), "utf8"))
  if (records.length !== 60 || new Set(records.map((record) => record.Name)).size !== 60) {
    throw new Error(`Expected 60 unique records, got ${records.length}`)
  }
  console.log("Worker parity: 60 unique records, JSON export passed")
} finally {
  await browser?.close()
  await fixtureServer?.close()
  await rm(directory, { recursive: true, force: true })
}
