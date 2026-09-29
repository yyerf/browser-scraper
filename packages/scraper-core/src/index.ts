import type {
  ExtractedRecord,
  FieldResult,
  HealingEvent,
  NavigationAction,
  RunCheckpoint,
  ScraperDefinition,
} from "@visual-scraper/schema"

export interface PageObservation {
  url: string
  records: ExtractedRecord[]
  navigation: NavigationAction[]
  stateSignature: string
  healedFields?: number
  healedRecords?: number
  healingEvents?: Array<Omit<HealingEvent, "timestamp">>
}

export interface RuntimeAdapter {
  observe(definition: ScraperDefinition): Promise<PageObservation>
  navigate(action: NavigationAction, definition: ScraperDefinition): Promise<boolean>
  waitForChange(previousSignature: string, timeoutMs: number): Promise<boolean>
}

export interface DatasetRepository {
  commit(
    runId: string,
    records: ExtractedRecord[],
    checkpoint: RunCheckpoint,
  ): Promise<{
    inserted: number
    duplicates: number
    checkpoint: RunCheckpoint
  }>
  loadCheckpoint(runId: string): Promise<RunCheckpoint | undefined>
  listRecords(runId: string): Promise<ExtractedRecord[]>
  listRecordHashes(runId: string): Promise<string[]>
}

export type RunEvent = {
  type:
    | "SCRAPE_STARTED"
    | "PAGE_EXTRACTED"
    | "DUPLICATE_SKIPPED"
    | "NAVIGATION_DETECTED"
    | "NAVIGATION_EXECUTED"
    | "NO_PROGRESS"
    | "SELECTOR_HEALED"
    | "RECORD_SELECTOR_HEALED"
    | "SCRAPE_COMPLETED"
    | "SCRAPE_CANCELLED"
    | "SCRAPE_FAILED"
  runId: string
  timestamp: string
  details?: Record<string, string | number | boolean | null>
}

export interface RunOptions {
  onEvent?: (event: RunEvent) => void
  signal?: AbortSignal
  now?: () => number
}

const text = (value: FieldResult): string => {
  if (value.status !== "success") return ""
  const normalized = value.normalizedValue
  if (normalized && typeof normalized === "object")
    return `${normalized.amount}:${normalized.currency ?? ""}`
  return String(normalized ?? value.rawValue ?? "")
}

function pathAllowed(pathname: string, patterns: string[]): boolean {
  if (!patterns.length) return true
  return patterns.some((pattern) => {
    const expression = `^${pattern
      .split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}$`
    return new RegExp(expression).test(pathname)
  })
}

export function canonicalRecordKey(record: ExtractedRecord, definition: ScraperDefinition): string {
  const byId = new Map(record.fields.map((field) => [field.fieldId, field]))
  const ids = definition.record.identityFieldIds.length
    ? definition.record.identityFieldIds
    : definition.fields.map((field) => field.id)
  return JSON.stringify(
    ids.map((id) => [
      id,
      text(
        byId.get(id) ?? {
          fieldId: id,
          status: "missing",
          rawValue: null,
          normalizedValue: null,
        },
      ),
    ]),
  )
}

/** A deterministic cross-runtime hash. Canonical keys are retained separately for collision checks. */
export function hashRecordKey(key: string): string {
  let hash = 0xcbf29ce484222325n
  for (const byte of new TextEncoder().encode(key)) {
    hash ^= BigInt(byte)
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash.toString(16).padStart(16, "0")
}

export function withRecordHash(
  record: ExtractedRecord,
  definition: ScraperDefinition,
): ExtractedRecord {
  return { ...record, hash: hashRecordKey(canonicalRecordKey(record, definition)) }
}

export class RunController {
  private paused = false
  private stopped = false

  constructor(
    private readonly runtime: RuntimeAdapter,
    private readonly repository: DatasetRepository,
    private readonly definition: ScraperDefinition,
    private readonly options: RunOptions = {},
  ) {}

  pause(): void {
    this.paused = true
  }
  stop(): void {
    this.stopped = true
  }

  private emit(type: RunEvent["type"], details?: RunEvent["details"]): void {
    this.options.onEvent?.({
      type,
      runId: this.runId,
      timestamp: new Date().toISOString(),
      details,
    })
  }

  private runId = ""

  async run(runId: string = crypto.randomUUID()): Promise<RunCheckpoint> {
    this.runId = runId
    const initialUrl = this.definition.scope.startUrls[0]
    if (!initialUrl) throw new Error("Definition has no start URL")
    const existing = await this.repository.loadCheckpoint(runId)
    const now = this.options.now ?? Date.now
    const started = now()
    let checkpoint: RunCheckpoint = existing ?? {
      runId,
      definitionId: this.definition.metadata.id,
      definitionRevision: this.definition.metadata.revision,
      startedAt: new Date(started).toISOString(),
      state: "initializing",
      pageCount: 0,
      recordCount: 0,
      duplicateCount: 0,
      healingCount: 0,
      healingEvents: [],
      currentUrl: initialUrl,
      epoch: 0,
      navigationAttempts: 0,
      noProgressCount: 0,
      recentStateSignatures: [],
      updatedAt: new Date().toISOString(),
    }
    if (
      checkpoint.definitionId !== this.definition.metadata.id ||
      checkpoint.definitionRevision !== this.definition.metadata.revision
    ) {
      throw new Error("Checkpoint definition revision mismatch")
    }
    this.emit("SCRAPE_STARTED")
    let noProgress = checkpoint.noProgressCount
    const seenStates = new Set(checkpoint.recentStateSignatures)
    const seenHashes = new Set(await this.repository.listRecordHashes(runId))

    try {
      while (true) {
        if (this.stopped || this.options.signal?.aborted) {
          checkpoint = {
            ...checkpoint,
            state: "cancelled",
            stopReason: "user_cancelled",
            updatedAt: new Date().toISOString(),
          }
          await this.repository.commit(runId, [], checkpoint)
          this.emit("SCRAPE_CANCELLED")
          return checkpoint
        }
        if (this.paused) {
          checkpoint = {
            ...checkpoint,
            state: "paused",
            stopReason: "user_paused",
            updatedAt: new Date().toISOString(),
          }
          await this.repository.commit(runId, [], checkpoint)
          return checkpoint
        }
        if (
          checkpoint.pageCount >= this.definition.navigation.maxPages ||
          checkpoint.recordCount >= this.definition.navigation.maxRecords ||
          now() - new Date(checkpoint.startedAt ?? new Date(started).toISOString()).getTime() >=
            this.definition.navigation.maxRuntimeMs
        ) {
          checkpoint = {
            ...checkpoint,
            state: "completed",
            stopReason: "limit_reached",
            updatedAt: new Date().toISOString(),
          }
          await this.repository.commit(runId, [], checkpoint)
          this.emit("SCRAPE_COMPLETED", { stopReason: "limit_reached" })
          return checkpoint
        }

        const observation = await this.runtime.observe(this.definition)
        const scope = this.definition.scope
        const observedUrl = new URL(observation.url)
        if (
          !scope.allowedOrigins.includes(observedUrl.origin) ||
          !pathAllowed(observedUrl.pathname, scope.allowedPathPatterns)
        ) {
          checkpoint = {
            ...checkpoint,
            state: "paused",
            stopReason: "outside_scope",
            updatedAt: new Date().toISOString(),
          }
          await this.repository.commit(runId, [], checkpoint)
          return checkpoint
        }
        const remaining = this.definition.navigation.maxRecords - checkpoint.recordCount
        let newRecords = 0
        const records = observation.records
          .filter((record) => record.fields.some((field) => field.status === "success"))
          .map((record) => withRecordHash(record, this.definition))
          .filter((record) => {
            if (seenHashes.has(record.hash)) return true
            if (newRecords >= remaining) return false
            seenHashes.add(record.hash)
            newRecords++
            return true
          })
        const priorEvents = checkpoint.healingEvents ?? []
        const eventKeys = new Set(
          priorEvents.map((event) =>
            JSON.stringify([event.kind, event.fieldId, event.oldSelector, event.newSelector]),
          ),
        )
        const newEvents: HealingEvent[] = []
        for (const event of observation.healingEvents ?? []) {
          const key = JSON.stringify([
            event.kind,
            event.fieldId,
            event.oldSelector,
            event.newSelector,
          ])
          if (eventKeys.has(key)) continue
          eventKeys.add(key)
          newEvents.push({ ...event, timestamp: new Date().toISOString() })
        }
        const provisional: RunCheckpoint = {
          ...checkpoint,
          state: "extracting",
          pageCount: checkpoint.pageCount + 1,
          healingCount: checkpoint.healingCount + newEvents.length,
          healingEvents: [...priorEvents, ...newEvents].slice(-100),
          currentUrl: observation.url,
          pendingActionId: undefined,
          updatedAt: new Date().toISOString(),
        }
        const committed = await this.repository.commit(runId, records, provisional)
        checkpoint = committed.checkpoint
        this.emit("PAGE_EXTRACTED", { page: checkpoint.pageCount, inserted: committed.inserted })
        for (const event of newEvents)
          this.emit(event.kind === "field" ? "SELECTOR_HEALED" : "RECORD_SELECTOR_HEALED", {
            fieldId: event.fieldId ?? null,
            oldSelector: event.oldSelector,
            newSelector: event.newSelector,
            confidence: event.confidence,
          })
        if (committed.duplicates) this.emit("DUPLICATE_SKIPPED", { count: committed.duplicates })

        const stateKey = `${observation.url}|${observation.stateSignature}`
        if (committed.inserted === 0 || seenStates.has(stateKey)) noProgress++
        else noProgress = 0
        seenStates.add(stateKey)
        checkpoint = {
          ...checkpoint,
          noProgressCount: noProgress,
          recentStateSignatures: [...seenStates].slice(-100),
        }
        await this.repository.commit(runId, [], checkpoint)
        if (noProgress >= this.definition.settings.noProgressLimit) {
          checkpoint = {
            ...checkpoint,
            state: "completed",
            stopReason: "no_progress",
            updatedAt: new Date().toISOString(),
          }
          await this.repository.commit(runId, [], checkpoint)
          this.emit("NO_PROGRESS", { attempts: noProgress })
          return checkpoint
        }
        if (checkpoint.navigationAttempts >= 300) {
          checkpoint = {
            ...checkpoint,
            state: "completed",
            stopReason: "navigation_limit",
            updatedAt: new Date().toISOString(),
          }
          await this.repository.commit(runId, [], checkpoint)
          return checkpoint
        }
        if (
          checkpoint.recordCount >= this.definition.navigation.maxRecords ||
          checkpoint.pageCount >= this.definition.navigation.maxPages
        )
          continue

        const candidates = observation.navigation
          .filter(
            (candidate) =>
              candidate.mode === this.definition.navigation.mode && candidate.confidence >= 0.85,
          )
          .sort((a, b) => b.confidence - a.confidence)
        if (!candidates.length) {
          checkpoint = {
            ...checkpoint,
            state: "completed",
            stopReason: "end_of_list",
            updatedAt: new Date().toISOString(),
          }
          await this.repository.commit(runId, [], checkpoint)
          this.emit("SCRAPE_COMPLETED", { stopReason: "end_of_list" })
          return checkpoint
        }

        let advanced = false
        for (const candidate of candidates) {
          if (this.paused || this.stopped || this.options.signal?.aborted) break
          this.emit("NAVIGATION_DETECTED", {
            mode: candidate.mode,
            confidence: candidate.confidence,
          })
          const pendingActionId = crypto.randomUUID()
          checkpoint = {
            ...checkpoint,
            state: "navigating",
            pendingActionId,
            navigationAttempts: checkpoint.navigationAttempts + 1,
            updatedAt: new Date().toISOString(),
          }
          await this.repository.commit(runId, [], checkpoint)
          await new Promise((resolve) =>
            setTimeout(resolve, this.definition.settings.minActionIntervalMs),
          )
          if (this.paused || this.stopped || this.options.signal?.aborted) break
          advanced = await this.runtime.navigate(candidate, this.definition)
          if (advanced) {
            this.emit("NAVIGATION_EXECUTED", { mode: candidate.mode })
            await this.runtime.waitForChange(
              observation.stateSignature,
              candidate.mode === "infinite-scroll"
                ? Math.min(3000, this.definition.settings.pageStabilityTimeoutMs)
                : this.definition.settings.pageStabilityTimeoutMs,
            )
            checkpoint = {
              ...checkpoint,
              state: "waiting",
              epoch: checkpoint.epoch + 1,
              pendingActionId: undefined,
              updatedAt: new Date().toISOString(),
            }
            await this.repository.commit(runId, [], checkpoint)
            break
          }
        }
        if (!advanced) noProgress++
      }
    } catch (error) {
      checkpoint = {
        ...checkpoint,
        state: "failed",
        stopReason: error instanceof Error ? error.message : "unknown_error",
        updatedAt: new Date().toISOString(),
      }
      await this.repository.commit(runId, [], checkpoint)
      this.emit("SCRAPE_FAILED", { reason: checkpoint.stopReason ?? "unknown_error" })
      throw error
    }
  }
}
