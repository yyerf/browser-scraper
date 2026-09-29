---
name: scraper-release-review
description: Review a Visual Scraper pilot build for acceptance, privacy, permissions, attribution, and documentation.
---

Run `pnpm check:release` and review its artifacts. Inspect generated manifests, permission prompts, storage behavior, exported CSV/XLSX values, source-control status, and third-party notices. Verify README installation steps for Chromium and Firefox plus worker login and run commands. Report unmet acceptance criteria with evidence and a concrete fix or limitation. Do not mark a pilot ready based only on a successful build.
