import { type DatasetRepository, RunController, type RuntimeAdapter } from "@visual-scraper/core"
import {
  buildDefinition,
  detectNavigation,
  executeNavigation,
  extractPage,
  generateLocator,
  type TrainingField,
  waitForPageChange,
} from "@visual-scraper/dom"
import {
  type ExtractedRecord,
  type NavigationMode,
  type RunCheckpoint,
  type ScraperDefinition,
  scraperDefinitionSchema,
} from "@visual-scraper/schema"
import { useEffect, useMemo, useRef, useState } from "react"
import ReactDOM from "react-dom/client"
import { mountShadow } from "./picker/mount"
import { runPicker } from "./picker/run"
import "./style.css"

type Binding = { runId: string; definitionId: string }
type Training = TrainingField & { id: string }

function SelectorEditor({
  label,
  selector,
  onPreview,
  onCommit,
}: {
  label: string
  selector: string
  onPreview: (value: string) => void
  onCommit: (value: string) => void
}) {
  const [draft, setDraft] = useState(selector)
  return (
    <input
      aria-label={label}
      style={inputStyle}
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value)
        onPreview(event.target.value)
      }}
      onBlur={() => onCommit(draft)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur()
      }}
    />
  )
}

const buttonStyle: React.CSSProperties = {
  border: "1px solid #cbd5e1",
  background: "#fff",
  color: "#172033",
  borderRadius: 6,
  padding: "7px 10px",
  cursor: "pointer",
  fontSize: 12,
}
const strongButton: React.CSSProperties = {
  ...buttonStyle,
  background: "#172033",
  color: "#fff",
  borderColor: "#172033",
}
const inputStyle: React.CSSProperties = {
  border: "1px solid #cbd5e1",
  borderRadius: 5,
  padding: "7px",
  width: "100%",
  fontSize: 12,
}

function extensionRepository(): DatasetRepository {
  return {
    commit(runId, records, checkpoint) {
      return browser.runtime.sendMessage({ kind: "scraper:commit", runId, records, checkpoint })
    },
    loadCheckpoint(runId) {
      return browser.runtime.sendMessage({ kind: "scraper:checkpoint", runId })
    },
    listRecords(runId) {
      return browser.runtime.sendMessage({ kind: "scraper:records", runId })
    },
  }
}

function pageRuntime(): RuntimeAdapter {
  return {
    async observe(definition) {
      return extractPage(definition)
    },
    async navigate(action, definition) {
      return executeNavigation(action, document, definition.scope.allowedOrigins)
    },
    async waitForChange(signature, timeoutMs) {
      const definition = currentDefinition
      return definition ? waitForPageChange(signature, timeoutMs, definition) : false
    },
  }
}

let currentDefinition: ScraperDefinition | null = null

function ScraperPanel({
  host,
  onClose,
  resume,
}: {
  host: HTMLElement
  onClose: () => void
  resume?: Binding
}) {
  const [training, setTraining] = useState<Training[]>([])
  const [pendingElement, setPendingElement] = useState<Element | null>(null)
  const [fieldName, setFieldName] = useState("")
  const [definition, setDefinition] = useState<ScraperDefinition | null>(null)
  const [saved, setSaved] = useState<ScraperDefinition[]>([])
  const [manualRecord, setManualRecord] = useState<Element | null>(null)
  const [preview, setPreview] = useState<ExtractedRecord[]>([])
  const [run, setRun] = useState<RunCheckpoint | null>(null)
  const [notice, setNotice] = useState("")
  const [busy, setBusy] = useState(false)
  const controller = useRef<RunController | null>(null)
  const highlights = useRef<HTMLDivElement[]>([])

  function clearHighlights(): void {
    for (const overlay of highlights.current) overlay.remove()
    highlights.current = []
  }

  function highlightMatches(selector: string, fieldId?: string): void {
    clearHighlights()
    if (!definition) return
    try {
      const records = fieldId
        ? Array.from(document.querySelectorAll(definition.record.locator.primarySelector)).slice(
            0,
            100,
          )
        : [document]
      const matches = records
        .flatMap((record) => Array.from(record.querySelectorAll(selector)))
        .slice(0, 100)
      for (const match of matches) {
        const rect = match.getBoundingClientRect()
        if (!rect.width || !rect.height) continue
        const overlay = document.createElement("div")
        overlay.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;border:2px solid #0d9488;background:#0d948822;pointer-events:none;z-index:2147483645`
        document.body.append(overlay)
        highlights.current.push(overlay)
      }
    } catch {
      /* An unfinished selector is allowed while typing. */
    }
  }

  function updateDefinition(next: ScraperDefinition): void {
    setDefinition(next)
    currentDefinition = next
    setPreview(extractPage(next).records)
  }

  function commitSelector(selector: string, fieldId?: string): void {
    clearHighlights()
    if (!definition) return
    try {
      document.createDocumentFragment().querySelector(selector)
    } catch {
      setNotice("Selector syntax is invalid")
      return
    }
    if (!selector.trim()) {
      setNotice("Selector cannot be empty")
      return
    }
    const candidate = { selector, score: 1, source: "manual" as const }
    const change = (locator: typeof definition.record.locator) => ({
      ...locator,
      primarySelector: selector,
      candidates: [
        candidate,
        ...locator.candidates.filter((item) => item.selector !== selector),
      ].slice(0, 20),
      confidence: 1,
    })
    const next = fieldId
      ? {
          ...definition,
          fields: definition.fields.map((field) =>
            field.id === fieldId ? { ...field, locator: change(field.locator) } : field,
          ),
        }
      : {
          ...definition,
          record: {
            ...definition.record,
            locator: change(definition.record.locator),
            confidence: 1,
          },
        }
    updateDefinition(next)
    setNotice("Selector updated; review the preview before saving")
  }

  useEffect(
    () => () => {
      for (const overlay of highlights.current) overlay.remove()
      highlights.current = []
    },
    [],
  )

  // Resume binding is read once when the panel mounts after a page load.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the mount effect must not restart a scrape on each render
  useEffect(() => {
    void browser.runtime.sendMessage({ kind: "scraper:listDefinitions" }).then(setSaved)
    if (resume) {
      void browser.runtime
        .sendMessage({ kind: "scraper:getDefinition", definitionId: resume.definitionId })
        .then((value: ScraperDefinition | undefined) => {
          if (value) {
            setDefinition(value)
            setPreview(extractPage(value).records)
            void start(value, resume.runId)
          }
        })
    }
  }, [])

  function refresh(fields: Training[], selectedRecord = manualRecord): void {
    if (!fields.length) {
      setDefinition(null)
      setPreview([])
      return
    }
    try {
      const next = buildDefinition(
        fields,
        `${location.hostname} records`,
        location.href,
        selectedRecord ?? undefined,
      )
      if (definition) {
        next.metadata = {
          ...next.metadata,
          id: definition.metadata.id,
          revision: definition.metadata.revision,
          createdAt: definition.metadata.createdAt,
        }
        for (const field of next.fields) {
          const previous = definition.fields.find((old) => old.name === field.name)
          if (previous) field.id = previous.id
        }
      }
      setDefinition(next)
      currentDefinition = next
      setPreview(extractPage(next).records)
      setNotice("")
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Add another example")
    }
  }

  async function pick(mode: "field" | "record" | "navigation"): Promise<void> {
    host.style.display = "none"
    try {
      const outcome = await runPicker({}, { copyOnConfirm: false })
      if (outcome.type !== "result" || !outcome.selected) return
      if (mode === "field") {
        setPendingElement(outcome.selected)
        const tag = outcome.selected.tagName.toLowerCase()
        setFieldName(tag === "img" ? "Image" : tag === "a" ? "URL" : "Field")
      } else if (mode === "record") {
        setManualRecord(outcome.selected)
        refresh(training, outcome.selected)
      } else if (definition) {
        const action = detectNavigation(document).find(
          (item) => item.locator && outcome.selected?.matches(item.locator.primarySelector),
        )
        const selected = action ?? {
          mode: "next-button" as const,
          confidence: 1,
          locator: generateLocator(outcome.selected, document),
          label: "User selected",
        }
        setDefinition({
          ...definition,
          navigation: {
            ...definition.navigation,
            mode: selected.mode,
            candidateActions: [selected],
          },
        })
      }
    } finally {
      host.style.display = ""
    }
  }

  function addField(): void {
    if (!pendingElement || !fieldName.trim()) return
    const next = [
      ...training,
      { id: crypto.randomUUID(), name: fieldName.trim(), element: pendingElement },
    ]
    setTraining(next)
    setPendingElement(null)
    setFieldName("")
    refresh(next)
  }

  async function save(): Promise<void> {
    if (!definition) return
    setBusy(true)
    try {
      const validated = scraperDefinitionSchema.parse(definition)
      const stored: ScraperDefinition = await browser.runtime.sendMessage({
        kind: "scraper:saveDefinition",
        definition: validated,
      })
      setDefinition(stored)
      setSaved((items) => [
        stored,
        ...items.filter((item) => item.metadata.id !== stored.metadata.id),
      ])
      setNotice("Scraper saved locally")
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Save failed")
    } finally {
      setBusy(false)
    }
  }

  async function start(value = definition, runId: string = crypto.randomUUID()): Promise<void> {
    if (!value) return
    currentDefinition = value
    setBusy(true)
    setNotice("")
    try {
      if (!resume || resume.runId !== runId) {
        await browser.runtime.sendMessage({ kind: "scraper:saveDefinition", definition: value })
        await browser.runtime.sendMessage({
          kind: "scraper:bind",
          definitionId: value.metadata.id,
          runId,
        })
      }
      const next = new RunController(pageRuntime(), extensionRepository(), value, {
        onEvent(event) {
          if (event.type === "PAGE_EXTRACTED")
            setNotice(`Page ${event.details?.page}: ${event.details?.inserted} new records`)
          if (event.type === "SELECTOR_HEALED")
            setNotice("A selector was recovered; review diagnostics")
        },
      })
      controller.current = next
      const done = await next.run(runId)
      setRun(done)
      if (["completed", "cancelled", "failed"].includes(done.state)) {
        await browser.runtime.sendMessage({ kind: "scraper:unbind" })
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Run failed")
    } finally {
      setBusy(false)
    }
  }

  async function loadSaved(id: string): Promise<void> {
    const value = saved.find((item) => item.metadata.id === id)
    if (!value) return
    setTraining([])
    setDefinition(value)
    currentDefinition = value
    setPreview(extractPage(value).records)
  }

  const columns = definition?.fields ?? []
  const navigationMode = definition?.navigation.mode ?? "none"
  const recordCount = useMemo(() => preview.length, [preview])

  return (
    <aside
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      style={{
        position: "fixed",
        top: 12,
        right: 12,
        bottom: 12,
        width: 340,
        zIndex: 2147483646,
        background: "#fff",
        color: "#172033",
        border: "1px solid #d8dee8",
        borderRadius: 10,
        boxShadow: "0 18px 50px #11182740",
        font: "13px system-ui",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header
        style={{
          padding: "14px 16px",
          borderBottom: "1px solid #e2e8f0",
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <div>
          <strong style={{ fontSize: 16 }}>Visual Scraper</strong>
          <div style={{ color: "#64748b", fontSize: 11 }}>{location.hostname}</div>
        </div>
        <button type="button" style={buttonStyle} onClick={onClose} aria-label="Close inspector">
          ✕
        </button>
      </header>
      <div
        style={{
          overflowY: "auto",
          padding: 16,
          flex: 1,
          display: "grid",
          alignContent: "start",
          gap: 14,
        }}
      >
        <section>
          <label htmlFor="saved-scraper">Saved scrapers</label>
          <select
            id="saved-scraper"
            style={inputStyle}
            value=""
            onChange={(event) => void loadSaved(event.target.value)}
          >
            <option value="">Create new or load saved…</option>
            {saved.map((item) => (
              <option key={item.metadata.id} value={item.metadata.id}>
                {item.metadata.name}
              </option>
            ))}
          </select>
        </section>
        <section>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong>Fields</strong>
            <button type="button" style={buttonStyle} onClick={() => void pick("field")}>
              Add field
            </button>
          </div>
          {columns.length === 0 && (
            <p style={{ color: "#64748b" }}>Click Add field, then pick an example on the page.</p>
          )}
          {columns.map((field) => (
            <div key={field.id} style={{ marginTop: 8 }}>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  aria-label={`Name ${field.name}`}
                  style={{ ...inputStyle, flex: 1 }}
                  value={field.name}
                  onChange={(event) =>
                    setDefinition((old) =>
                      old
                        ? {
                            ...old,
                            fields: old.fields.map((entry) =>
                              entry.id === field.id
                                ? { ...entry, name: event.target.value }
                                : entry,
                            ),
                          }
                        : old,
                    )
                  }
                />
                <button
                  type="button"
                  style={buttonStyle}
                  aria-label={`Remove ${field.name}`}
                  onClick={() => {
                    if (!definition) return
                    const next = {
                      ...definition,
                      fields: definition.fields.filter((entry) => entry.id !== field.id),
                    }
                    setDefinition(next)
                    setPreview(extractPage(next).records)
                  }}
                >
                  ✕
                </button>
              </div>
              <details style={{ marginTop: 4, fontSize: 11, color: "#475569" }}>
                <summary>Selector and extraction</summary>
                <SelectorEditor
                  label={`Selector ${field.name}`}
                  selector={field.locator.primarySelector}
                  onPreview={(value) => highlightMatches(value, field.id)}
                  onCommit={(value) => commitSelector(value, field.id)}
                />
                <label htmlFor={`extract-${field.id}`}>Extract</label>
                <select
                  id={`extract-${field.id}`}
                  style={inputStyle}
                  value={field.extractionMode}
                  onChange={(event) => {
                    if (!definition) return
                    updateDefinition({
                      ...definition,
                      fields: definition.fields.map((entry) =>
                        entry.id === field.id
                          ? {
                              ...entry,
                              extractionMode: event.target.value as typeof field.extractionMode,
                            }
                          : entry,
                      ),
                    })
                  }}
                >
                  {(
                    [
                      "textContent",
                      "innerText",
                      "href",
                      "src",
                      "srcset",
                      "alt",
                      "title",
                      "value",
                      "computedUrl",
                    ] as const
                  ).map((mode) => (
                    <option key={mode} value={mode}>
                      {mode}
                    </option>
                  ))}
                </select>
                <div>
                  Confidence {Math.round(field.locator.confidence * 100)}% ·{" "}
                  {field.locator.candidates.length} alternatives
                </div>
              </details>
            </div>
          ))}
          {pendingElement && (
            <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
              <input
                aria-label="Field name"
                style={inputStyle}
                value={fieldName}
                onChange={(event) => setFieldName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") addField()
                }}
              />
              <button type="button" style={strongButton} onClick={addField}>
                Add
              </button>
            </div>
          )}
        </section>
        <section style={{ display: "grid", gap: 8 }}>
          <strong>Records detected: {recordCount}</strong>
          <span>
            Record confidence: {definition ? Math.round(definition.record.confidence * 100) : 0}%
            score
          </span>
          <button type="button" style={buttonStyle} onClick={() => void pick("record")}>
            Select record container
          </button>
          {definition && (
            <details style={{ fontSize: 11, color: "#475569" }}>
              <summary>Record selector and diagnostics</summary>
              <SelectorEditor
                key={definition.metadata.id}
                label="Record selector"
                selector={definition.record.locator.primarySelector}
                onPreview={(value) => highlightMatches(value)}
                onCommit={(value) => commitSelector(value)}
              />
              <div>
                {definition.record.locator.candidates.length} selector alternatives · {recordCount}{" "}
                records in preview
              </div>
            </details>
          )}
        </section>
        <section style={{ display: "grid", gap: 8 }}>
          <label htmlFor="navigation-mode">
            <strong>Pagination</strong>
          </label>
          <select
            id="navigation-mode"
            style={inputStyle}
            value={navigationMode}
            onChange={(event) =>
              setDefinition((old) =>
                old
                  ? {
                      ...old,
                      navigation: {
                        ...old.navigation,
                        mode: event.target.value as NavigationMode,
                      },
                    }
                  : old,
              )
            }
          >
            <option value="none">None</option>
            <option value="next-button">Next button</option>
            <option value="numbered-pagination">Numbered pages</option>
            <option value="load-more">Load More</option>
            <option value="infinite-scroll">Infinite scroll</option>
            <option value="url-pagination">URL pages</option>
          </select>
          <button type="button" style={buttonStyle} onClick={() => void pick("navigation")}>
            Select navigation action
          </button>
          {definition && (
            <div style={{ fontSize: 11, color: "#475569" }}>
              {detectNavigation(document)
                .slice(0, 3)
                .map((action) => (
                  <div key={`${action.mode}-${action.label}`}>
                    {action.label ?? action.mode}: {Math.round(action.confidence * 100)}%
                  </div>
                ))}
            </div>
          )}
        </section>
        {definition && (
          <section style={{ display: "grid", gap: 6 }}>
            <strong>Run limits</strong>
            <label htmlFor="limit-pages">Maximum pages</label>
            <input
              id="limit-pages"
              type="number"
              min={1}
              max={1000}
              style={inputStyle}
              value={definition.navigation.maxPages}
              onChange={(event) =>
                setDefinition({
                  ...definition,
                  navigation: {
                    ...definition.navigation,
                    maxPages: Math.max(1, Number(event.target.value) || 1),
                  },
                })
              }
            />
            <label htmlFor="limit-records">Maximum records</label>
            <input
              id="limit-records"
              type="number"
              min={1}
              max={100000}
              style={inputStyle}
              value={definition.navigation.maxRecords}
              onChange={(event) =>
                setDefinition({
                  ...definition,
                  navigation: {
                    ...definition.navigation,
                    maxRecords: Math.max(1, Number(event.target.value) || 1),
                  },
                })
              }
            />
            <label htmlFor="action-delay">Delay between actions (ms)</label>
            <input
              id="action-delay"
              type="number"
              min={0}
              max={60000}
              style={inputStyle}
              value={definition.settings.minActionIntervalMs}
              onChange={(event) =>
                setDefinition({
                  ...definition,
                  settings: {
                    ...definition.settings,
                    minActionIntervalMs: Math.max(0, Number(event.target.value) || 0),
                  },
                })
              }
            />
          </section>
        )}
        <section>
          <strong>Preview</strong>
          <div
            style={{
              overflowX: "auto",
              maxHeight: 230,
              overflowY: "auto",
              border: "1px solid #e2e8f0",
            }}
          >
            <table style={{ borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr>
                  {columns.map((field) => (
                    <th key={field.id} style={{ padding: 5, textAlign: "left" }}>
                      {field.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, 10).map((record) => (
                  <tr key={JSON.stringify(record.fields.map((field) => field.rawValue))}>
                    {columns.map((field) => (
                      <td
                        key={field.id}
                        style={{ padding: 5, borderTop: "1px solid #e2e8f0", whiteSpace: "nowrap" }}
                      >
                        {record.fields
                          .find((value) => value.fieldId === field.id)
                          ?.rawValue?.slice(0, 60) ?? "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        {run && (
          <section>
            <strong>{run.state}</strong>
            <div>
              Pages {run.pageCount} · Records {run.recordCount} · Duplicates {run.duplicateCount} ·
              Recoveries {run.healingCount}
            </div>
            {run.stopReason && <div>Reason: {run.stopReason}</div>}
            <button
              type="button"
              style={buttonStyle}
              onClick={() =>
                void browser.runtime.sendMessage({
                  kind: "scraper:openResults",
                  runId: run.runId,
                  definitionId: run.definitionId,
                })
              }
            >
              View and export results
            </button>
          </section>
        )}
        {notice && (
          <p role="status" style={{ color: "#475569", margin: 0 }}>
            {notice}
          </p>
        )}
      </div>
      <footer style={{ padding: 12, display: "flex", gap: 6, borderTop: "1px solid #e2e8f0" }}>
        <button
          type="button"
          disabled={!definition || busy}
          style={buttonStyle}
          onClick={() => void save()}
        >
          Save
        </button>
        <button
          type="button"
          disabled={!definition || busy}
          style={strongButton}
          onClick={() => void start()}
        >
          {busy ? "Scraping…" : "Start scraping"}
        </button>
        {busy && (
          <>
            <button type="button" style={buttonStyle} onClick={() => controller.current?.pause()}>
              Pause
            </button>
            <button type="button" style={buttonStyle} onClick={() => controller.current?.stop()}>
              Stop
            </button>
          </>
        )}
        {run?.state === "paused" && (
          <button
            type="button"
            style={buttonStyle}
            onClick={() => void start(definition, run.runId)}
          >
            Resume
          </button>
        )}
      </footer>
    </aside>
  )
}

export default defineContentScript({
  matches: [],
  registration: "runtime",
  cssInjectionMode: "ui",
  async main() {
    const context = window as typeof window & { __visualScraperLoaded?: boolean }
    if (context.__visualScraperLoaded) return
    context.__visualScraperLoaded = true
    let close: (() => void) | undefined
    async function open(resume?: Binding) {
      if (close) return
      const mount = await mountShadow()
      const root = ReactDOM.createRoot(mount.container)
      close = () => {
        root.unmount()
        mount.remove()
        close = undefined
      }
      root.render(<ScraperPanel host={mount.host} onClose={() => close?.()} resume={resume} />)
    }
    browser.runtime.onMessage.addListener((message: { kind?: string }) => {
      if (message?.kind === "scraper:open") {
        void open()
        return false
      }
      return false
    })
    const binding: Binding | undefined = await browser.runtime.sendMessage({
      kind: "scraper:contentReady",
    })
    if (binding) void open(binding)
  },
})
