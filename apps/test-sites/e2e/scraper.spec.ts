import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { chromium, expect, test } from "@playwright/test"

const extensionPath = resolve("apps/extension/.output/chrome-mv3")

test("teach four fields, traverse three pages, and export results", async () => {
  const testExtensionPath = await mkdtemp(join(tmpdir(), "visual-scraper-test-"))
  await cp(extensionPath, testExtensionPath, { recursive: true })
  const manifestPath = join(testExtensionPath, "manifest.json")
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>
  manifest.host_permissions = ["http://127.0.0.1/*"]
  await writeFile(manifestPath, JSON.stringify(manifest))
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    args: [
      `--disable-extensions-except=${testExtensionPath}`,
      `--load-extension=${testExtensionPath}`,
    ],
  })
  try {
    const [worker] = context.serviceWorkers()
    const serviceWorker = worker ?? (await context.waitForEvent("serviceworker"))
    const extensionId = new URL(serviceWorker.url()).hostname
    const site = await context.newPage()
    await site.goto("http://127.0.0.1:4173/?mode=next&page=1")
    const popup = await context.newPage()
    await popup.goto(`chrome-extension://${extensionId}/popup.html`)
    await popup.getByRole("button", { name: "Start scraper" }).click()
    await expect(site.locator("visual-scraper-ui")).toHaveCount(1)
    const panelPalette = await site.evaluate(() => {
      const shadow = document.querySelector("visual-scraper-ui")?.shadowRoot
      if (!shadow) throw new Error("Inspector shadow root missing")
      const hostileTheme = document.createElement("style")
      hostileTheme.textContent =
        "aside[style],button[style],input[style],select[style]{background-color:#171717!important}"
      shadow.appendChild(hostileTheme)
      const panel = shadow.querySelector("#visual-scraper-inspector")
      const button = panel?.querySelector("button")
      if (!panel || !button) throw new Error("Inspector controls missing")
      return {
        background: getComputedStyle(panel).backgroundColor,
        text: getComputedStyle(panel).color,
        buttonBackground: getComputedStyle(button).backgroundColor,
        buttonText: getComputedStyle(button).color,
      }
    })
    expect(panelPalette).toEqual({
      background: "rgb(255, 255, 255)",
      text: "rgb(23, 32, 51)",
      buttonBackground: "rgb(255, 255, 255)",
      buttonText: "rgb(23, 32, 51)",
    })

    async function addField(selector: string, name: string) {
      await site
        .locator("visual-scraper-ui")
        .first()
        .getByRole("button", { name: "Add field" })
        .click()
      await site.locator("article").first().locator(selector).click()
      await site.locator("visual-scraper-ui").last().getByRole("button", { name: "OK" }).click()
      const panel = site.locator("visual-scraper-ui").first()
      await panel.getByRole("textbox", { name: "Field name" }).fill(name)
      await panel.getByRole("button", { name: "Add", exact: true }).click()
    }

    await addField("h2", "Name")
    await addField(".price", "Price")
    await addField(".rating", "Rating")
    await addField("img", "Image")
    await expect(site.locator("visual-scraper-ui").first()).toContainText("Records detected: 20")
    await site
      .locator("visual-scraper-ui")
      .first()
      .getByRole("button", { name: "Start scraping" })
      .click()
    await expect(site.locator("visual-scraper-ui").first()).toContainText("Records 60", {
      timeout: 100000,
    })
    const resultPagePromise = context.waitForEvent("page")
    await site
      .locator("visual-scraper-ui")
      .first()
      .getByRole("button", { name: "View and export results" })
      .click()
    const results = await resultPagePromise
    await results.waitForLoadState()
    await expect(results.locator("main")).toContainText("60 records")
    const downloadPromise = results.waitForEvent("download")
    await results.getByRole("button", { name: "Download JSON" }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.json$/)
    const json = JSON.parse(await readFile(await download.path(), "utf8")) as Array<
      Record<string, unknown>
    >
    expect(json).toHaveLength(60)
    expect(new Set(json.map((record) => record.Name)).size).toBe(60)
    for (const format of ["CSV", "XLSX"] as const) {
      const pending = results.waitForEvent("download")
      await results.getByRole("button", { name: `Download ${format}` }).click()
      const file = await pending
      expect(file.suggestedFilename().toLowerCase()).toMatch(
        new RegExp(`\\.${format.toLowerCase()}$`),
      )
      expect((await readFile(await file.path())).byteLength).toBeGreaterThan(100)
    }
    const definitionDownload = results.waitForEvent("download")
    await results.getByRole("button", { name: "Download definition" }).click()
    const definitionFile = await definitionDownload
    const portable = JSON.parse(await readFile(await definitionFile.path(), "utf8")) as {
      version: number
      fields: unknown[]
    }
    expect(portable.version).toBe(1)
    expect(portable.fields).toHaveLength(4)

    await site.goto("http://127.0.0.1:4173/?mode=next&page=1&mutation=wrapper")
    const reopen = await context.newPage()
    await reopen.goto(`chrome-extension://${extensionId}/popup.html`)
    await reopen.getByRole("button", { name: "Start scraper" }).click()
    const panel = site.locator("visual-scraper-ui").first()
    await expect(panel).toHaveCount(1)
    await panel.getByLabel("Saved scrapers").selectOption({ index: 1 })
    await expect(panel).toContainText("Records detected: 20")
    await panel.getByRole("button", { name: "Start scraping" }).click()
    await expect(panel).toContainText("Records 60", { timeout: 100000 })
    await expect(panel).toContainText("Recoveries 1")
    const recoveredResultsPromise = context.waitForEvent("page")
    await panel.getByRole("button", { name: "View and export results" }).click()
    const recoveredResults = await recoveredResultsPromise
    await expect(
      recoveredResults.getByRole("heading", { name: "Selector recoveries" }),
    ).toBeVisible()
    await expect(recoveredResults.locator("section li")).toHaveCount(1)
    await expect(recoveredResults.locator("section li")).toContainText("Price:")

    await site.goto("http://127.0.0.1:4173/?mode=next&page=1&mutation=record")
    const recordReopen = await context.newPage()
    await recordReopen.goto(`chrome-extension://${extensionId}/popup.html`)
    await recordReopen.getByRole("button", { name: "Start scraper" }).click()
    const recordPanel = site.locator("visual-scraper-ui").first()
    await recordPanel.getByLabel("Saved scrapers").selectOption({ index: 1 })
    await expect(recordPanel).toContainText("Records detected: 20")
    await recordPanel.getByLabel("Maximum pages").fill("1")
    await recordPanel.getByRole("button", { name: "Start scraping" }).click()
    await expect(recordPanel).toContainText("Records 20", { timeout: 100000 })
    await expect(recordPanel).toContainText("Recoveries 1")

    await recordPanel.getByRole("button", { name: "Add field" }).click()
    await site.locator(".catalog-item .rating").first().click()
    await site.locator("visual-scraper-ui").last().getByRole("button", { name: "OK" }).click()
    await recordPanel.getByRole("textbox", { name: "Field name" }).fill("Extra rating")
    await recordPanel.getByRole("button", { name: "Add", exact: true }).click()
    await expect(recordPanel.getByLabel("Name Price")).toBeVisible()
    await expect(recordPanel.getByLabel("Name Extra rating")).toBeVisible()
    await expect(recordPanel).toContainText("Records detected: 20")
    await recordPanel.getByRole("button", { name: "Select record container" }).click()
    await site.locator(".catalog-item").first().click()
    await site.locator("visual-scraper-ui").last().getByRole("button", { name: "OK" }).click()
    await expect(recordPanel.getByLabel("Name Extra rating")).toBeVisible()
    await expect(recordPanel).toContainText("Records detected: 20")
  } finally {
    await context.close()
    await rm(testExtensionPath, { recursive: true, force: true })
  }
})

test("pagination, scrolling, shadow DOM, and duplicate fixtures", async () => {
  test.setTimeout(240000)
  const testExtensionPath = await mkdtemp(join(tmpdir(), "visual-scraper-modes-"))
  await cp(extensionPath, testExtensionPath, { recursive: true })
  const manifestPath = join(testExtensionPath, "manifest.json")
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>
  manifest.host_permissions = ["http://127.0.0.1/*"]
  await writeFile(manifestPath, JSON.stringify(manifest))
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    args: [
      `--disable-extensions-except=${testExtensionPath}`,
      `--load-extension=${testExtensionPath}`,
    ],
  })
  try {
    const [worker] = context.serviceWorkers()
    const serviceWorker = worker ?? (await context.waitForEvent("serviceworker"))
    const extensionId = new URL(serviceWorker.url()).hostname
    for (const mode of [
      "load-more",
      "infinite",
      "spa",
      "numbered",
      "url-pagination",
      "duplicate",
      "dynamic-classes",
      "shadow",
      "nested",
    ] as const) {
      if (process.env.FIXTURE_MODES && !process.env.FIXTURE_MODES.split(",").includes(mode))
        continue
      console.log(`Fixture: ${mode}`)
      const site = await context.newPage()
      const fixture =
        mode === "url-pagination" ? "numbered" : mode === "dynamic-classes" ? "next" : mode
      await site.goto(
        `http://127.0.0.1:4173/?mode=${fixture}&page=1${mode === "dynamic-classes" ? "&mutation=dynamic&seed=1" : ""}`,
      )
      const popup = await context.newPage()
      await popup.goto(`chrome-extension://${extensionId}/popup.html`)
      await popup.getByRole("button", { name: "Start scraper" }).click()
      const panel = site.locator("visual-scraper-ui").first()
      await expect(panel).toHaveCount(1)
      await panel.getByRole("button", { name: "Add field" }).click()
      await site.locator("article h2").first().click()
      await site.locator("visual-scraper-ui").last().getByRole("button", { name: "OK" }).click()
      await panel.getByRole("textbox", { name: "Field name" }).fill("Name")
      await panel.getByRole("button", { name: "Add", exact: true }).click()
      await expect(panel).toContainText("Records detected: 20")
      if (mode === "url-pagination")
        await panel.getByLabel("Pagination").selectOption("url-pagination")
      if (mode === "shadow" || mode === "nested") await panel.getByLabel("Maximum pages").fill("1")
      await panel.getByRole("button", { name: "Start scraping" }).click()
      const expectedCount =
        mode === "duplicate" ? 55 : mode === "shadow" || mode === "nested" ? 20 : 60
      await expect(panel).toContainText(`Records ${expectedCount}`, { timeout: 100000 })
      if (mode === "duplicate") await expect(panel).toContainText("Duplicates 5")
      await site.close()
    }
  } finally {
    await context.close()
    await rm(testExtensionPath, { recursive: true, force: true })
  }
})

test("pause survives a reload and blocks the pending navigation", async () => {
  test.setTimeout(90000)
  const testExtensionPath = await mkdtemp(join(tmpdir(), "visual-scraper-pause-"))
  await cp(extensionPath, testExtensionPath, { recursive: true })
  const manifestPath = join(testExtensionPath, "manifest.json")
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>
  manifest.host_permissions = ["http://127.0.0.1/*"]
  await writeFile(manifestPath, JSON.stringify(manifest))
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    args: [
      `--disable-extensions-except=${testExtensionPath}`,
      `--load-extension=${testExtensionPath}`,
    ],
  })
  try {
    const [worker] = context.serviceWorkers()
    const serviceWorker = worker ?? (await context.waitForEvent("serviceworker"))
    const extensionId = new URL(serviceWorker.url()).hostname
    const site = await context.newPage()
    await site.goto("http://127.0.0.1:4173/?mode=load-more&page=1")
    const popup = await context.newPage()
    await popup.goto(`chrome-extension://${extensionId}/popup.html`)
    await popup.getByRole("button", { name: "Start scraper" }).click()
    const panel = site.locator("visual-scraper-ui").first()
    await panel.getByRole("button", { name: "Add field" }).click()
    await site.locator("article h2").first().click()
    await site.locator("visual-scraper-ui").last().getByRole("button", { name: "OK" }).click()
    await panel.getByRole("textbox", { name: "Field name" }).fill("Name")
    await panel.getByRole("button", { name: "Add", exact: true }).click()
    await panel.getByLabel("Delay between actions (ms)").fill("3000")
    await panel.getByRole("button", { name: "Start scraping" }).click()
    await expect(panel).toContainText("Page 1: 20 new records")
    await panel.getByRole("button", { name: "Pause" }).click()
    await expect(panel).toContainText("paused", { timeout: 10000 })
    await expect(site.locator("article")).toHaveCount(20)

    await site.reload()
    const restored = site.locator("visual-scraper-ui").first()
    await expect(restored).toContainText("paused")
    await expect(restored).toContainText("Records 20")
    await expect(site.locator("article")).toHaveCount(20)
    await restored.getByRole("button", { name: "Resume" }).click()
    await expect(restored).toContainText("Records 60", { timeout: 60000 })
  } finally {
    await context.close()
    await rm(testExtensionPath, { recursive: true, force: true })
  }
})
