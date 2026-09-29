# Scraper definition contract

The authoritative Zod schemas are in `packages/scraper-schema/src/index.ts`. Version 1 definitions contain metadata and revision, start URLs and allowed origins, a record locator and inference confidence, field locators and extraction modes, navigation mode and limits, and runtime settings. All locators store a primary selector, scored alternatives, a fingerprint, confidence, and an explicit path through open shadow roots or same-origin frames. No live DOM references are persisted.

Fields resolve relative to each record container. Their results retain raw and normalized values plus `success`, `missing`, `invalid`, `error`, or `ambiguous` status. Currency normalization retains a text amount and symbol/code; ambiguous values are preserved as raw text. Run checkpoints are separate from definitions and datasets.

Checkpoints retain up to 100 distinct selector recovery events with their original selector, replacement selector, confidence, field ID where applicable, and timestamp. Recovery count measures distinct changes across a run, rather than the number of records extracted with a recovered selector. Older checkpoints load with an empty event list.

An incompatible contract change requires a new version and migration; altering the meaning of version 1 in place would break saved definitions and worker parity. Runtime adapters must consume validated definitions and preserve field IDs when renaming fields.
