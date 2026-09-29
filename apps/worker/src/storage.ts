import { canonicalRecordKey, type DatasetRepository } from "@visual-scraper/core"
import {
  type ExtractedRecord,
  extractedRecordSchema,
  type RunCheckpoint,
  runCheckpointSchema,
  type ScraperDefinition,
  scraperDefinitionSchema,
} from "@visual-scraper/schema"
import Database from "better-sqlite3"

export class WorkerRepository implements DatasetRepository {
  private readonly db: Database.Database

  constructor(path: string) {
    this.db = new Database(path)
    this.db.pragma("journal_mode = WAL")
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        run_id TEXT PRIMARY KEY,
        definition_json TEXT NOT NULL,
        profile_name TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS records (
        run_id TEXT NOT NULL,
        hash TEXT NOT NULL,
        record_json TEXT NOT NULL,
        PRIMARY KEY(run_id, hash)
      );
      CREATE TABLE IF NOT EXISTS checkpoints (
        run_id TEXT PRIMARY KEY,
        checkpoint_json TEXT NOT NULL
      );
    `)
  }

  saveRun(runId: string, definition: ScraperDefinition, profileName: string): void {
    const parsed = scraperDefinitionSchema.parse(definition)
    this.db
      .prepare(
        "INSERT OR IGNORE INTO runs (run_id, definition_json, profile_name) VALUES (?, ?, ?)",
      )
      .run(runId, JSON.stringify(parsed), profileName)
  }

  getRun(runId: string): { definition: ScraperDefinition; profileName: string } | undefined {
    const row = this.db
      .prepare("SELECT definition_json, profile_name FROM runs WHERE run_id = ?")
      .get(runId) as { definition_json: string; profile_name: string } | undefined
    return row
      ? {
          definition: scraperDefinitionSchema.parse(JSON.parse(row.definition_json)),
          profileName: row.profile_name,
        }
      : undefined
  }

  async commit(runId: string, input: ExtractedRecord[], inputCheckpoint: RunCheckpoint) {
    const checkpoint = runCheckpointSchema.parse(inputCheckpoint)
    if (checkpoint.runId !== runId) throw new Error("Run ID mismatch")
    const definition = this.getRun(runId)?.definition
    if (!definition) throw new Error("Unknown run")
    const transaction = this.db.transaction(() => {
      const previous = this.db
        .prepare("SELECT checkpoint_json FROM checkpoints WHERE run_id = ?")
        .get(runId) as { checkpoint_json: string } | undefined
      const old = previous
        ? runCheckpointSchema.parse(JSON.parse(previous.checkpoint_json))
        : undefined
      let inserted = 0
      let duplicates = 0
      const get = this.db.prepare("SELECT record_json FROM records WHERE run_id = ? AND hash = ?")
      const put = this.db.prepare(
        "INSERT INTO records (run_id, hash, record_json) VALUES (?, ?, ?)",
      )
      for (const item of input) {
        const record = extractedRecordSchema.parse(item)
        const prior = get.get(runId, record.hash) as { record_json: string } | undefined
        if (prior) {
          const original = extractedRecordSchema.parse(JSON.parse(prior.record_json))
          if (canonicalRecordKey(original, definition) !== canonicalRecordKey(record, definition)) {
            throw new Error("Record hash collision; data was not discarded")
          }
          duplicates++
        } else {
          put.run(runId, record.hash, JSON.stringify(record))
          inserted++
        }
      }
      const updated: RunCheckpoint = {
        ...checkpoint,
        recordCount: Math.max(checkpoint.recordCount, old?.recordCount ?? 0) + inserted,
        duplicateCount: Math.max(checkpoint.duplicateCount, old?.duplicateCount ?? 0) + duplicates,
      }
      this.db
        .prepare(
          "INSERT INTO checkpoints (run_id, checkpoint_json) VALUES (?, ?) ON CONFLICT(run_id) DO UPDATE SET checkpoint_json = excluded.checkpoint_json",
        )
        .run(runId, JSON.stringify(updated))
      return { inserted, duplicates, checkpoint: updated }
    })
    return transaction()
  }

  async loadCheckpoint(runId: string): Promise<RunCheckpoint | undefined> {
    const row = this.db
      .prepare("SELECT checkpoint_json FROM checkpoints WHERE run_id = ?")
      .get(runId) as { checkpoint_json: string } | undefined
    return row ? runCheckpointSchema.parse(JSON.parse(row.checkpoint_json)) : undefined
  }

  async listRecords(runId: string): Promise<ExtractedRecord[]> {
    const rows = this.db
      .prepare("SELECT record_json FROM records WHERE run_id = ? ORDER BY rowid")
      .all(runId) as Array<{ record_json: string }>
    return rows.map((row) => extractedRecordSchema.parse(JSON.parse(row.record_json)))
  }

  async listRecordHashes(runId: string): Promise<string[]> {
    const rows = this.db.prepare("SELECT hash FROM records WHERE run_id = ?").all(runId) as Array<{
      hash: string
    }>
    return rows.map((row) => row.hash)
  }

  close(): void {
    this.db.close()
  }
}
