import { extractedRecordSchema, scraperDefinitionSchema } from "@visual-scraper/schema"
import ExcelJS from "exceljs"
import { expect, test } from "vitest"
import { exportCsv, exportJson, exportXlsx } from "./index"

const locator = {
  contextPath: [],
  primarySelector: "span",
  candidates: [],
  fingerprint: {
    tagName: "span",
    stableAttributes: {},
    classes: [],
    ancestorTags: [],
    childTags: [],
    nearbyLabels: [],
    siblingTypeIndex: 0,
    depth: 1,
    contentKind: "text",
  },
  confidence: 0.8,
}
const definition = scraperDefinitionSchema.parse({
  version: 1,
  metadata: {
    id: "export-fixture",
    revision: 1,
    name: "Export fixture",
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt: "2026-09-29T00:00:00.000Z",
  },
  scope: {
    startUrls: ["https://example.test/catalog"],
    allowedOrigins: ["https://example.test"],
  },
  record: { locator },
  fields: [
    { id: "name", name: "Name", type: "text", extractionMode: "textContent", locator },
    { id: "price", name: "Price", type: "number", extractionMode: "textContent", locator },
    { id: "note", name: "Note", type: "text", extractionMode: "textContent", locator },
  ],
  navigation: { mode: "none" },
  settings: {},
})
const record = extractedRecordSchema.parse({
  hash: "fixture",
  sourceUrl: "https://example.test/catalog",
  fields: [
    {
      fieldId: "name",
      status: "success",
      rawValue: '東京, "Blue"\nLine',
      normalizedValue: '東京, "Blue"\nLine',
    },
    { fieldId: "price", status: "success", rawValue: "-12.5", normalizedValue: -12.5 },
    { fieldId: "note", status: "success", rawValue: "=1+2", normalizedValue: "=1+2" },
  ],
})

test("CSV quotes Unicode and multiline text, preserves numbers, and neutralizes formulas", () => {
  const csv = exportCsv(definition, [record])
  expect(csv).toBe('\uFEFF"Name","Price","Note"\r\n"東京, ""Blue""\nLine","-12.5","\'=1+2"\r\n')
})

test("XLSX retains numeric cells and escaped text", async () => {
  const workbook = new ExcelJS.Workbook()
  const bytes = Buffer.from(await exportXlsx(definition, [record]))
  await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0])
  const sheet = workbook.getWorksheet("Results")
  expect(sheet?.getCell("A2").value).toBe('東京, "Blue"\nLine')
  expect(sheet?.getCell("B2").value).toBe(-12.5)
  expect(sheet?.getCell("C2").value).toBe("'=1+2")
})

test("JSON retains normalized data without spreadsheet escaping", () => {
  expect(JSON.parse(exportJson(definition, [record]))).toEqual([
    { Name: '東京, "Blue"\nLine', Price: -12.5, Note: "=1+2" },
  ])
})
