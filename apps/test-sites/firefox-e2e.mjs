import { execFile } from "node:child_process"
import { chmod, cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { promisify } from "node:util"
import { Browser, Builder, By, until } from "selenium-webdriver"
import firefox from "selenium-webdriver/firefox.js"
import { createServer } from "vite"

const execute = promisify(execFile)
const source = resolve("apps/extension/.output/firefox-mv3")
const directory = await mkdtemp(join(tmpdir(), "visual-scraper-firefox-"))
const extension = join(directory, "extension")
let driver
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
  await cp(source, extension, { recursive: true })
  const manifestPath = join(extension, "manifest.json")
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  manifest.host_permissions = ["http://127.0.0.1/*"]
  await writeFile(manifestPath, JSON.stringify(manifest))
  const xpi = join(directory, "visual-scraper.xpi")
  await execute("zip", ["-qr", xpi, "."], { cwd: extension })
  const firefoxLauncher = join(directory, "firefox-launcher")
  await writeFile(
    firefoxLauncher,
    '#!/bin/sh\nexec /usr/bin/firefox -remote-allow-system-access "$@"\n',
  )
  await chmod(firefoxLauncher, 0o755)
  driver = await new Builder()
    .forBrowser(Browser.FIREFOX)
    .setFirefoxOptions(new firefox.Options().setBinary(firefoxLauncher).addArguments("-headless"))
    .build()
  const addonId = await driver.installAddon(xpi, true)
  await driver.setContext(firefox.Context.CHROME)
  const mapping = JSON.parse(
    await driver.executeScript(
      "return Services.prefs.getStringPref('extensions.webextensions.uuids')",
    ),
  )
  await driver.setContext(firefox.Context.CONTENT)
  const uuid = mapping[addonId]
  if (!uuid) throw new Error(`Firefox installed ${addonId}, but its extension UUID was unavailable`)
  await driver.setContext(firefox.Context.CHROME)
  await driver.executeScript(`return (async () => {
    const { ExtensionPermissions } = ChromeUtils.importESModule("resource://gre/modules/ExtensionPermissions.sys.mjs")
    await ExtensionPermissions.add("${addonId}", { permissions: [], origins: ["http://127.0.0.1/*"] })
    return true
  })()`)
  await driver.setContext(firefox.Context.CONTENT)
  await driver.get("http://127.0.0.1:4173/?mode=next&page=1")
  await driver.switchTo().newWindow("tab")
  await driver.get(`moz-extension://${uuid}/popup.html`)
  const permissionState =
    await driver.executeAsyncScript(`const done = arguments[arguments.length - 1];
    browser.permissions.contains({origins:["http://127.0.0.1/*"]}).then(done, error => done(String(error)))`)
  if (permissionState !== true) throw new Error("Firefox fixture site permission was not granted")
  await driver.findElement(By.xpath("//button[contains(., 'Start scraper')]")).click()
  const handles = await driver.getAllWindowHandles()
  for (const handle of handles) {
    await driver.switchTo().window(handle)
    if ((await driver.getCurrentUrl()).startsWith("http://127.0.0.1")) break
  }
  try {
    await driver.wait(until.elementLocated(By.css("visual-scraper-ui")), 15000)
  } catch (error) {
    const diagnostics = []
    for (const handle of await driver.getAllWindowHandles()) {
      await driver.switchTo().window(handle)
      diagnostics.push({
        url: await driver.getCurrentUrl(),
        text: (await driver.findElement(By.css("body")).getText()).slice(0, 500),
      })
    }
    throw new Error(`Firefox inspector absent: ${JSON.stringify(diagnostics)}`, { cause: error })
  }
  const panelRoot = await (await driver.findElement(By.css("visual-scraper-ui"))).getShadowRoot()
  async function clickButton(root, label) {
    const buttons = await root.findElements(By.css("button"))
    for (const button of buttons) {
      if ((await button.getText()).trim() === label) {
        await button.click()
        return
      }
    }
    throw new Error(`Button ${label} not found`)
  }
  await clickButton(panelRoot, "Add field")
  await driver.findElement(By.css("article h2")).click()
  const hosts = await driver.findElements(By.css("visual-scraper-ui"))
  await clickButton(await hosts.at(-1).getShadowRoot(), "OK")
  await (await panelRoot.findElement(By.css("[aria-label='Field name']"))).sendKeys("Name")
  await clickButton(panelRoot, "Add")
  await driver.wait(
    async () =>
      (await (await panelRoot.findElement(By.css("aside"))).getText()).includes(
        "Records detected: 20",
      ),
    15000,
  )
  await clickButton(panelRoot, "Start scraping")
  await driver.wait(async () => {
    try {
      const panels = await driver.findElements(By.css("visual-scraper-ui"))
      if (!panels.length) return false
      const shadow = await panels[0].getShadowRoot()
      return (await (await shadow.findElement(By.css("aside"))).getText()).includes("Records 60")
    } catch {
      return false
    }
  }, 60000)
  console.log("Firefox MV3: picker, 20-record preview, and 60-record pagination passed")
} finally {
  try {
    await driver?.quit()
  } catch {
    /* Preserve the test failure above. */
  }
  await fixtureServer?.close()
  await rm(directory, { recursive: true, force: true })
}
