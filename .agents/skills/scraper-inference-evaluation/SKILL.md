---
name: scraper-inference-evaluation
description: Evaluate changes to record inference, field generalization, confidence scoring, and selector healing.
---

Read `docs/INFERENCE_ENGINE.md`. Reproduce the behavior with deterministic fixtures and a separate expected-output oracle. Include near misses, generated class names, optional wrappers, and a plausible wrong candidate. Compare precision, coverage, ambiguity, and processing budgets before and after the change. Treat scores as policy values until they are calibrated against held-out cases. Keep failed examples visible in diagnostics.
