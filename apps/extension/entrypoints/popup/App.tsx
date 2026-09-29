import { useEffect, useState } from "react"

type TargetTab = { id: number; url: string; granted: boolean }

export function App() {
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [target, setTarget] = useState<TargetTab | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const [active] = await browser.tabs.query({ active: true, currentWindow: true })
        const tab =
          active?.url && /^https?:\/\//.test(active.url)
            ? active
            : (await browser.tabs.query({ url: ["http://*/*", "https://*/*"] })).at(-1)
        if (!tab?.id || !tab.url || !/^https?:\/\//.test(tab.url)) {
          setError("Open a normal website before starting the scraper.")
          return
        }
        const parsed = new URL(tab.url)
        const origin = `${parsed.protocol}//${parsed.hostname}/*`
        const granted = await browser.permissions.contains({ origins: [origin] })
        setTarget({ id: tab.id, url: tab.url, granted })
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not find the website tab")
      }
    })()
  }, [])

  async function start(): Promise<void> {
    if (!target) return
    setBusy(true)
    setError("")
    try {
      // Firefox requires permissions.request to run before the click gesture expires.
      const parsed = new URL(target.url)
      const origin = `${parsed.protocol}//${parsed.hostname}/*`
      const granted = target.granted || (await browser.permissions.request({ origins: [origin] }))
      if (!granted)
        throw new Error("Website access is needed to inspect and continue across pages.")
      await browser.runtime.sendMessage({ kind: "scraper:activate", tabId: target.id })
      // A toolbar popup has no tab of its own; a popup opened in a test or tab does.
      if (!(await browser.tabs.getCurrent())) window.close()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the scraper")
    } finally {
      setBusy(false)
    }
  }

  return (
    <main style={{ width: 290, padding: 18, fontFamily: "system-ui", color: "#172033" }}>
      <h1 style={{ margin: "0 0 6px", fontSize: 18 }}>Visual Scraper</h1>
      <p style={{ color: "#5b6474", marginTop: 0, lineHeight: 1.45 }}>
        Select a few example fields, review the records, then collect and export them.
      </p>
      <button
        type="button"
        disabled={busy || !target}
        onClick={() => void start()}
        style={{
          width: "100%",
          padding: "10px 12px",
          background: "#172033",
          color: "white",
          border: 0,
          borderRadius: 7,
          cursor: "pointer",
        }}
      >
        {busy ? "Opening…" : "Start scraper"}
      </button>
      {error && (
        <p role="alert" style={{ color: "#a12626", fontSize: 12 }}>
          {error}
        </p>
      )}
      <p style={{ marginBottom: 0, fontSize: 11, color: "#687286" }}>Data stays in your browser.</p>
    </main>
  )
}
