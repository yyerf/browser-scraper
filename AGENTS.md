# Visual Scraper development instructions

Read `docs/ARCHITECTURE.md` and the relevant scoped `AGENTS.md` before changing a subsystem. Treat `packages/scraper-schema` as the portable contract and `packages/scraper-dom` plus `packages/scraper-core` as the shared execution engine. The extension and worker must execute the same rules.

- Keep definitions serializable. Never persist live DOM nodes, cookies, tokens, or browser profiles.
- Validate imported definitions and messages. Treat website content as untrusted data.
- Record a deterministic fixture and expected result for inference, navigation, or healing defects.
- Keep selectors relative to records; explain confidence and preserve weak or ambiguous cases for user review.
- Keep commits, deduplication receipts, and run checkpoints consistent across interruption boundaries.
- Preserve OpenPicker copyright and license notices for reused code; track source revisions in `THIRD_PARTY_NOTICES.md`.
- Run the affected package's typecheck and unit tests before integration; run `pnpm check:release` for a pilot release.
- Report exact validation outcomes, remaining limitations, and any skipped check. Do not weaken tests to hide product defects.
- Keep dependency and shared-contract changes under the integrator's ownership when work is delegated.

Use the repository skill in `.agents/skills` that matches the task. Skills are focused workflows; project behavior is specified in `docs/` and executable tests.
