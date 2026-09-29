# Selector engine

`generateLocator` collects semantic attributes, stable IDs/classes, tag selectors, and an `@medv/finder` candidate. It scores match count in the correct root, semantic value, and selector complexity. A record locator may match many records. A field locator is evaluated inside one record and need only match correctly there.

Fingerprinting records tag, stable attributes, classes, ancestor and child tags, nearby semantic labels, sibling type index, depth, and content kind. Generated CSS hashes, long numeric suffixes, UUID-like IDs, and sensitive attributes are filtered. The matcher compares structural and semantic signals with a bounded score.

On extraction, the engine checks the primary selector, then alternatives, validating matches against the stored fingerprint. A bounded descendant search is the last recovery step. It requires the configured confidence threshold and margin over the runner-up; ambiguous candidates remain missing. Recovery counts are written to run checkpoints and emitted as structured events. See `packages/scraper-dom/src/index.test.ts` for the changed-price fixture.

An open shadow root is encoded as a context step rather than a cross-boundary CSS selector. Same-origin iframe steps use `contentDocument`. Closed roots and cross-origin frames remain outside the current runtime.
