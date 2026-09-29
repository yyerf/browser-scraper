# Shared package ownership

- Packages must not import application code. Schema is independent of browser and Node APIs.
- Keep inference and policy deterministic, bounded, and explainable.
- A field locator is evaluated relative to a record; a record locator is evaluated in its browsing context.
- Preserve raw values when normalization is ambiguous. Return explicit missing or ambiguous statuses rather than guessing.
- Update schema round-trip and runtime parity tests when a public contract changes.
