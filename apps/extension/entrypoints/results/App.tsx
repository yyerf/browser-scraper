import { exportCsv, exportJson, exportXlsx } from "@visual-scraper/export"
import type { ExtractedRecord, RunCheckpoint, ScraperDefinition } from "@visual-scraper/schema"
import { useEffect, useState } from "react"

const params = new URLSearchParams(location.search)
const runId = params.get("runId") ?? ""
const definitionId = params.get("definitionId") ?? ""

function download(name: string, data: BlobPart, mime: string): void {
  const url = URL.createObjectURL(new Blob([data], { type: mime }))
  const link = document.createElement("a")
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}

export function App() {
  const [definition, setDefinition] = useState<ScraperDefinition | null>(null)
  const [records, setRecords] = useState<ExtractedRecord[]>([])
  const [checkpoint, setCheckpoint] = useState<RunCheckpoint | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void Promise.all([
      browser.runtime.sendMessage({ kind: "scraper:getDefinition", definitionId }),
      browser.runtime.sendMessage({ kind: "scraper:records", runId }),
      browser.runtime.sendMessage({ kind: "scraper:checkpoint", runId }),
    ])
      .then(([found, data, progress]) => {
        setDefinition(found ?? null)
        setRecords(data ?? [])
        setCheckpoint(progress ?? null)
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Could not load results"),
      )
  }, [])

  async function save(format: "json" | "csv" | "xlsx"): Promise<void> {
    if (!definition) return
    setBusy(true)
    try {
      const name = `${definition.metadata.name.replace(/[^a-z0-9_-]+/gi, "-") || "scraper"}-${runId.slice(0, 8)}`
      if (format === "json")
        download(`${name}.json`, exportJson(definition, records), "application/json;charset=utf-8")
      else if (format === "csv")
        download(`${name}.csv`, exportCsv(definition, records), "text/csv;charset=utf-8")
      else
        download(
          `${name}.xlsx`,
          await exportXlsx(definition, records),
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Export failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <main
      style={{
        maxWidth: 1100,
        margin: "24px auto",
        padding: 24,
        fontFamily: "system-ui",
        color: "#172033",
      }}
    >
      <h1 style={{ marginBottom: 4 }}>{definition?.metadata.name ?? "Scraper results"}</h1>
      <p style={{ color: "#64748b" }}>
        Run {runId} · {checkpoint?.state ?? "Loading"} · {records.length} records ·{" "}
        {checkpoint?.duplicateCount ?? 0} duplicates skipped · {checkpoint?.healingCount ?? 0}{" "}
        selector recoveries
      </p>
      {checkpoint?.stopReason && <p>Stopped: {checkpoint.stopReason}</p>}
      {error && (
        <p role="alert" style={{ color: "#a12626" }}>
          {error}
        </p>
      )}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {(["csv", "xlsx", "json"] as const).map((format) => (
          <button
            type="button"
            key={format}
            disabled={!definition || busy}
            onClick={() => void save(format)}
            style={{
              padding: "9px 14px",
              border: "1px solid #cbd5e1",
              borderRadius: 6,
              background: "#fff",
              cursor: "pointer",
            }}
          >
            Download {format.toUpperCase()}
          </button>
        ))}
        <button
          type="button"
          disabled={!definition}
          onClick={() => {
            if (!definition) return
            download(
              `${definition.metadata.name.replace(/[^a-z0-9_-]+/gi, "-") || "scraper"}-definition.json`,
              JSON.stringify(definition, null, 2),
              "application/json;charset=utf-8",
            )
          }}
          style={{
            padding: "9px 14px",
            border: "1px solid #cbd5e1",
            borderRadius: 6,
            background: "#fff",
            cursor: "pointer",
          }}
        >
          Download definition
        </button>
      </div>
      {definition && (
        <div style={{ overflow: "auto", border: "1px solid #e2e8f0", borderRadius: 8 }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
            <thead>
              <tr>
                {definition.fields.map((field) => (
                  <th
                    key={field.id}
                    style={{ textAlign: "left", padding: 10, background: "#f8fafc" }}
                  >
                    {field.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.slice(0, 100).map((record) => (
                <tr key={record.hash}>
                  {definition.fields.map((field) => (
                    <td key={field.id} style={{ padding: 10, borderTop: "1px solid #e2e8f0" }}>
                      {record.fields.find((value) => value.fieldId === field.id)?.rawValue ?? "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {records.length > 100 && (
        <p style={{ color: "#64748b" }}>
          Showing the first 100 records. Exports include every record.
        </p>
      )}
      {!!checkpoint?.healingEvents.length && (
        <section style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 18 }}>Selector recoveries</h2>
          <ul style={{ paddingLeft: 20 }}>
            {checkpoint.healingEvents.map((event) => {
              const field = definition?.fields.find((item) => item.id === event.fieldId)
              return (
                <li
                  key={`${event.kind}-${event.fieldId ?? "record"}-${event.oldSelector}-${event.newSelector}`}
                  style={{ marginBottom: 8 }}
                >
                  {field?.name ?? "Record container"}: <code>{event.oldSelector}</code> →{" "}
                  <code>{event.newSelector}</code> ({Math.round(event.confidence * 100)}%,{" "}
                  {new Date(event.timestamp).toLocaleString()})
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </main>
  )
}
