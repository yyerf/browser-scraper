import {
  type ExtractedRecord,
  type RunCheckpoint,
  scraperDefinitionSchema,
} from "@visual-scraper/schema"
import { expect, test } from "vitest"
import { type DatasetRepository, RunController, type RuntimeAdapter } from "./index"

const now = "2026-09-29T00:00:00.000Z"
const fingerprint = {
  tagName: "article",
  stableAttributes: {},
  classes: [],
  ancestorTags: [],
  childTags: [],
  nearbyLabels: [],
  siblingTypeIndex: 0,
  depth: 1,
  contentKind: "text",
}
const locator = {
  contextPath: [],
  primarySelector: "article",
  candidates: [],
  fingerprint,
  confidence: 0.9,
}

function definition() {
  return scraperDefinitionSchema.parse({
    version: 1,
    metadata: { id: "fixture", revision: 1, name: "Fixture", createdAt: now, updatedAt: now },
    scope: {
      startUrls: ["https://example.test/catalog/1"],
      allowedOrigins: ["https://example.test"],
      allowedPathPatterns: ["/catalog/*"],
    },
    record: { locator, confidence: 0.9, identityFieldIds: [] },
    fields: [
      {
        id: "name",
        name: "Name",
        type: "text",
        extractionMode: "textContent",
        locator,
        optional: false,
        transforms: ["trim"],
      },
    ],
    navigation: {
      mode: "next-button",
      candidateActions: [],
      maxPages: 10,
      maxRecords: 100,
      maxRuntimeMs: 60000,
    },
    settings: {
      minActionIntervalMs: 0,
      pageStabilityTimeoutMs: 100,
      noProgressLimit: 2,
      healingThreshold: 0.9,
      healingMargin: 0.1,
    },
  })
}

function repository(): DatasetRepository {
  const checkpoints = new Map<string, RunCheckpoint>()
  const records = new Map<string, ExtractedRecord>()
  return {
    async commit(runId, input, checkpoint) {
      let inserted = 0
      let duplicates = 0
      for (const record of input) {
        const key = `${runId}:${record.hash}`
        if (records.has(key)) duplicates++
        else {
          records.set(key, record)
          inserted++
        }
      }
      const previous = checkpoints.get(runId)
      const updated = {
        ...checkpoint,
        recordCount: (previous?.recordCount ?? 0) + inserted,
        duplicateCount: (previous?.duplicateCount ?? 0) + duplicates,
      }
      checkpoints.set(runId, updated)
      return { inserted, duplicates, checkpoint: updated }
    },
    async loadCheckpoint(runId) {
      return checkpoints.get(runId)
    },
    async listRecords() {
      return [...records.values()]
    },
    async listRecordHashes() {
      return [...records.values()].map((record) => record.hash)
    },
  }
}

const record: ExtractedRecord = {
  hash: "",
  sourceUrl: "https://example.test/catalog/1",
  fields: [
    { fieldId: "name", status: "success", rawValue: "Product 1", normalizedValue: "Product 1" },
  ],
}

test("deduplicates repeated states and stops a non-progressing navigation loop", async () => {
  const runtime: RuntimeAdapter = {
    async observe() {
      return {
        url: "https://example.test/catalog/1",
        records: [record],
        navigation: [{ mode: "next-button", confidence: 0.95, label: "Next" }],
        stateSignature: "same",
      }
    },
    async navigate() {
      return true
    },
    async waitForChange() {
      return false
    },
  }
  const result = await new RunController(runtime, repository(), definition()).run("loop")
  expect(result.state).toBe("completed")
  expect(result.stopReason).toBe("no_progress")
  expect(result.recordCount).toBe(1)
  expect(result.duplicateCount).toBeGreaterThan(0)
})

test("pauses before extracting a path outside the configured scope", async () => {
  const runtime: RuntimeAdapter = {
    async observe() {
      return {
        url: "https://example.test/admin",
        records: [record],
        navigation: [],
        stateSignature: "admin",
      }
    },
    async navigate() {
      return false
    },
    async waitForChange() {
      return false
    },
  }
  const result = await new RunController(runtime, repository(), definition()).run("scope")
  expect(result.state).toBe("paused")
  expect(result.stopReason).toBe("outside_scope")
  expect(result.recordCount).toBe(0)
})

test("persists one recovery event for the same selector change on multiple pages", async () => {
  let page = 0
  const events: string[] = []
  const runtime: RuntimeAdapter = {
    async observe() {
      page++
      return {
        url: `https://example.test/catalog/${page}`,
        records: [{ ...record, sourceUrl: `https://example.test/catalog/${page}` }],
        navigation: page < 2 ? [{ mode: "next-button", confidence: 0.95, label: "Next" }] : [],
        stateSignature: `page-${page}`,
        healingEvents: [
          {
            kind: "field",
            fieldId: "name",
            oldSelector: ".old-name",
            newSelector: ".name",
            confidence: 0.94,
          },
        ],
      }
    },
    async navigate() {
      return true
    },
    async waitForChange() {
      return true
    },
  }
  const result = await new RunController(runtime, repository(), definition(), {
    onEvent(event) {
      events.push(event.type)
    },
  }).run("recovery")
  expect(result.healingCount).toBe(1)
  expect(result.healingEvents).toHaveLength(1)
  expect(result.healingEvents[0]).toMatchObject({
    oldSelector: ".old-name",
    newSelector: ".name",
    confidence: 0.94,
  })
  expect(events.filter((event) => event === "SELECTOR_HEALED")).toHaveLength(1)
})

test("a pause requested before navigation prevents the pending click", async () => {
  let navigations = 0
  const runtime: RuntimeAdapter = {
    async observe() {
      return {
        url: "https://example.test/catalog/1",
        records: [record],
        navigation: [{ mode: "next-button", confidence: 0.95, label: "Next" }],
        stateSignature: "first-page",
      }
    },
    async navigate() {
      navigations++
      return true
    },
    async waitForChange() {
      return true
    },
  }
  let controller: RunController
  controller = new RunController(runtime, repository(), definition(), {
    onEvent(event) {
      if (event.type === "NAVIGATION_DETECTED") controller.pause()
    },
  })
  const result = await controller.run("pause-before-click")
  expect(result.state).toBe("paused")
  expect(result.recordCount).toBe(1)
  expect(navigations).toBe(0)
})

test("record limit counts new records after duplicates on the same page", async () => {
  let page = 0
  const item = (id: number): ExtractedRecord => ({
    hash: "",
    sourceUrl: `https://example.test/catalog/${page}`,
    fields: [
      {
        fieldId: "name",
        status: "success",
        rawValue: `Product ${id}`,
        normalizedValue: `Product ${id}`,
      },
    ],
  })
  const runtime: RuntimeAdapter = {
    async observe() {
      page++
      return {
        url: `https://example.test/catalog/${page}`,
        records: (page === 1 ? [1, 2, 3] : [1, 2, 3, 4, 5, 6]).map(item),
        navigation: page === 1 ? [{ mode: "next-button", confidence: 0.95 }] : [],
        stateSignature: `page-${page}`,
      }
    },
    async navigate() {
      return true
    },
    async waitForChange() {
      return true
    },
  }
  const config = definition()
  config.navigation.maxRecords = 5
  const result = await new RunController(runtime, repository(), config).run(
    "limit-after-duplicates",
  )
  expect(result.recordCount).toBe(5)
  expect(result.duplicateCount).toBe(3)
  expect(result.stopReason).toBe("limit_reached")
})
