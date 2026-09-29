---
name: scraper-contract-change
description: Change Visual Scraper definitions, events, results, or checkpoints shared by the extension and worker.
---

Read `docs/SCRAPER_SCHEMA.md` and the current Zod schema. Identify every producer and consumer in both runtimes. Change the schema and inferred TypeScript types together. Define import and version-compatibility behavior, update examples and migrations where needed, and test serialization plus extension/worker parity. Keep definitions free of executable code and live DOM references.
