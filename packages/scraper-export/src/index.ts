import type { ExtractedRecord, FieldResult, ScraperDefinition } from "@visual-scraper/schema"

type CellValue = string | number | boolean

function displayValue(result: FieldResult | undefined): CellValue {
  if (result?.status !== "success") return ""
  const value = result.normalizedValue
  if (value && typeof value === "object")
    return `${value.amount}${value.currency ? ` ${value.currency}` : ""}`
  return value === null ? (result.rawValue ?? "") : value
}

function rows(definition: ScraperDefinition, records: ExtractedRecord[]): CellValue[][] {
  return records.map((record) => {
    const values = new Map(record.fields.map((field) => [field.fieldId, field]))
    return definition.fields.map((field) => displayValue(values.get(field.id)))
  })
}

/** Prevent spreadsheet software from interpreting scraped page strings as formulas. */
export function literalSpreadsheetText(value: string): string {
  let candidate = value.trimStart()
  while (candidate.length && candidate.charCodeAt(0) < 32) candidate = candidate.slice(1)
  return /^[=+\-@]/.test(candidate) ? `'${value}` : value
}

function spreadsheetCell(value: CellValue): CellValue {
  return typeof value === "string" ? literalSpreadsheetText(value) : value
}

function csvCell(value: CellValue): string {
  const safe = String(spreadsheetCell(value))
  return `"${safe.replace(/"/g, '""')}"`
}

export function exportCsv(definition: ScraperDefinition, records: ExtractedRecord[]): string {
  const header = definition.fields.map((field) => field.name)
  return (
    "\uFEFF" +
    [header, ...rows(definition, records)].map((row) => row.map(csvCell).join(",")).join("\r\n") +
    "\r\n"
  )
}

export function exportJson(
  definition: ScraperDefinition,
  records: ExtractedRecord[],
  detailed = false,
): string {
  if (detailed)
    return JSON.stringify(
      { definitionId: definition.metadata.id, revision: definition.metadata.revision, records },
      null,
      2,
    )
  const data = records.map((record) => {
    const values = new Map(record.fields.map((field) => [field.fieldId, field]))
    return Object.fromEntries(
      definition.fields.map((field) => [
        field.name,
        values.get(field.id)?.normalizedValue ?? values.get(field.id)?.rawValue ?? null,
      ]),
    )
  })
  return JSON.stringify(data, null, 2)
}

export async function exportXlsx(
  definition: ScraperDefinition,
  records: ExtractedRecord[],
): Promise<ArrayBuffer> {
  const ExcelJS = await import("exceljs")
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Results")
  sheet.columns = definition.fields.map((field) => ({
    header: field.name,
    key: field.id,
    width: 24,
  }))
  const fields = definition.fields
  for (const record of records) {
    const values = new Map(record.fields.map((field) => [field.fieldId, field]))
    sheet.addRow(
      Object.fromEntries(
        fields.map((field) => [field.id, spreadsheetCell(displayValue(values.get(field.id)))]),
      ),
    )
  }
  return workbook.xlsx.writeBuffer()
}
