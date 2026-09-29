import { runCheckpointSchema } from "@visual-scraper/schema"
import { extensionRepository, getDefinition, listDefinitions, saveDefinition } from "@/lib/storage"

type ActiveRun = { runId: string; definitionId: string; tabId: number }
type ScraperMessage = {
  kind?: string
  definition?: unknown
  definitionId?: string
  runId?: string
  records?: unknown
  checkpoint?: unknown
  tabId?: number
}

const ACTIVE_KEY = "activeScraperRuns"

async function activeRuns(): Promise<Record<string, ActiveRun>> {
  const stored = await browser.storage.local.get(ACTIVE_KEY)
  return (stored[ACTIVE_KEY] ?? {}) as Record<string, ActiveRun>
}

async function bindRun(tabId: number, definitionId: string, runId: string): Promise<void> {
  const all = await activeRuns()
  all[String(tabId)] = { tabId, definitionId, runId }
  await browser.storage.local.set({ [ACTIVE_KEY]: all })
}

async function unbindRun(tabId: number): Promise<void> {
  const all = await activeRuns()
  delete all[String(tabId)]
  await browser.storage.local.set({ [ACTIVE_KEY]: all })
}

async function inject(tabId: number): Promise<void> {
  // Chromium expects a relative file while WXT's generated type includes a leading slash.
  await browser.scripting.executeScript({
    target: { tabId },
    files: ["content-scripts/content.js" as "/content-scripts/content.js"],
  })
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((raw: unknown, sender) => {
    if (sender.id !== browser.runtime.id) return false
    const message = raw as ScraperMessage
    if (!message || typeof message.kind !== "string") return false
    return (async () => {
      switch (message.kind) {
        case "scraper:activate": {
          const tabId = message.tabId
          if (typeof tabId !== "number") throw new Error("Target tab required")
          await inject(tabId)
          return browser.tabs.sendMessage(tabId, { kind: "scraper:open" })
        }
        case "scraper:contentReady": {
          const tabId = sender.tab?.id
          if (tabId === undefined) return undefined
          return (await activeRuns())[String(tabId)]
        }
        case "scraper:bind": {
          const tabId = sender.tab?.id
          if (tabId === undefined || !message.definitionId || !message.runId)
            throw new Error("Invalid run binding")
          await bindRun(tabId, message.definitionId, message.runId)
          return true
        }
        case "scraper:unbind": {
          const tabId = sender.tab?.id
          if (tabId !== undefined) await unbindRun(tabId)
          return true
        }
        case "scraper:saveDefinition":
          return saveDefinition(message.definition)
        case "scraper:listDefinitions":
          return listDefinitions()
        case "scraper:getDefinition":
          return message.definitionId ? getDefinition(message.definitionId) : undefined
        case "scraper:commit": {
          if (!message.runId || !Array.isArray(message.records) || !message.checkpoint)
            throw new Error("Invalid commit")
          return extensionRepository.commit(
            message.runId,
            message.records,
            runCheckpointSchema.parse(message.checkpoint),
          )
        }
        case "scraper:checkpoint":
          return message.runId ? extensionRepository.loadCheckpoint(message.runId) : undefined
        case "scraper:records":
          return message.runId ? extensionRepository.listRecords(message.runId) : []
        case "scraper:recordHashes":
          return message.runId ? extensionRepository.listRecordHashes(message.runId) : []
        case "scraper:openResults": {
          if (!message.runId || !message.definitionId) throw new Error("Results run required")
          const query = new URLSearchParams({
            runId: message.runId,
            definitionId: message.definitionId,
          })
          await browser.tabs.create({ url: browser.runtime.getURL(`/results.html?${query}`) })
          return true
        }
        default:
          return undefined
      }
    })()
  })

  browser.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status !== "complete") return
    void activeRuns().then(async (runs) => {
      if (!runs[String(tabId)]) return
      try {
        await inject(tabId)
      } catch {
        /* Source may be restricted or gone. */
      }
    })
  })

  browser.tabs.onRemoved.addListener((tabId) => {
    void unbindRun(tabId)
  })
})
