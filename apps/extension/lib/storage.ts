import { canonicalRecordKey, type DatasetRepository } from "@visual-scraper/core"
import {
  type ExtractedRecord,
  extractedRecordSchema,
  type RunCheckpoint,
  runCheckpointSchema,
  type ScraperDefinition,
  scraperDefinitionSchema,
} from "@visual-scraper/schema"
import { type DBSchema, openDB } from "idb"

interface ScraperDb extends DBSchema {
  records: {
    key: string
    value: { key: string; runId: string; record: ExtractedRecord }
    indexes: { "by-run": string }
  }
  checkpoints: { key: string; value: RunCheckpoint }
}

const dbPromise = openDB<ScraperDb>("visual-scraper", 1, {
  upgrade(db) {
    const records = db.createObjectStore("records", { keyPath: "key" })
    records.createIndex("by-run", "runId")
    db.createObjectStore("checkpoints", { keyPath: "runId" })
  },
})

export const extensionRepository: DatasetRepository = {
  async commit(runId, input, inputCheckpoint) {
    const checkpoint = runCheckpointSchema.parse(inputCheckpoint)
    if (checkpoint.runId !== runId) throw new Error("Run ID mismatch")
    const records = input.map((record) => extractedRecordSchema.parse(record))
    const definition = await getDefinition(checkpoint.definitionId)
    if (!definition) throw new Error("Run definition not found")
    const db = await dbPromise
    const tx = db.transaction(["records", "checkpoints"], "readwrite")
    const store = tx.objectStore("records")
    const previous = await tx.objectStore("checkpoints").get(runId)
    let inserted = 0
    let duplicates = 0
    for (const record of records) {
      const key = `${runId}:${record.hash}`
      const prior = await store.get(key)
      if (prior) {
        if (canonicalRecordKey(prior.record, definition) !== canonicalRecordKey(record, definition))
          throw new Error("Record hash collision; data was not discarded")
        duplicates++
      } else {
        await store.put({ key, runId, record })
        inserted++
      }
    }
    const updated: RunCheckpoint = {
      ...checkpoint,
      recordCount: Math.max(checkpoint.recordCount, previous?.recordCount ?? 0) + inserted,
      duplicateCount:
        Math.max(checkpoint.duplicateCount, previous?.duplicateCount ?? 0) + duplicates,
    }
    await tx.objectStore("checkpoints").put(updated)
    await tx.done
    return { inserted, duplicates, checkpoint: updated }
  },
  async loadCheckpoint(runId) {
    const db = await dbPromise
    const value = await db.get("checkpoints", runId)
    return value ? runCheckpointSchema.parse(value) : undefined
  },
  async listRecords(runId) {
    const db = await dbPromise
    const values = await db.getAllFromIndex("records", "by-run", runId)
    return values.map((entry) => entry.record)
  },
  async listRecordHashes(runId) {
    const db = await dbPromise
    const keys = await db.getAllKeysFromIndex("records", "by-run", runId)
    return keys.map((key) => String(key).slice(runId.length + 1))
  },
}

const DEFINITIONS_KEY = "scraperDefinitions"

export async function listDefinitions(): Promise<ScraperDefinition[]> {
  const stored = await browser.storage.local.get(DEFINITIONS_KEY)
  const raw = stored[DEFINITIONS_KEY]
  if (!raw || typeof raw !== "object") return []
  return Object.values(raw as Record<string, unknown>)
    .map((value) => scraperDefinitionSchema.safeParse(value))
    .filter((result) => result.success)
    .map((result) => result.data)
}

export async function saveDefinition(input: unknown): Promise<ScraperDefinition> {
  const definition = scraperDefinitionSchema.parse(input)
  const all = await listDefinitions()
  const existing = all.find((item) => item.metadata.id === definition.metadata.id)
  if (existing && definition.metadata.revision < existing.metadata.revision) {
    throw new Error("Cannot overwrite a newer scraper revision")
  }
  const next = Object.fromEntries(all.map((item) => [item.metadata.id, item]))
  next[definition.metadata.id] = definition
  await browser.storage.local.set({ [DEFINITIONS_KEY]: next })
  return definition
}

export async function getDefinition(id: string): Promise<ScraperDefinition | undefined> {
  return (await listDefinitions()).find((item) => item.metadata.id === id)
}
