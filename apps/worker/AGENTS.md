# Worker ownership

- Execute only validated `ScraperDefinition` revisions using the shared browser engine.
- Keep the worker's browser profile separate from the user's extension profile. Login is a manual local browser action.
- Use Crawlee for browser lifecycle and bounded retry. Keep one stateful browsing journey per start URL.
- Commit records and checkpoints idempotently. A retry must not multiply records or blindly repeat an action with unknown outcome.
- Keep profiles, datasets, and logs out of source control and export bundles.
