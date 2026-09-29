---
name: scraper-runtime-recovery
description: Verify extension or worker changes involving navigation, storage, messaging, cancellation, or interruption recovery.
---

Read `docs/ARCHITECTURE.md` and `docs/NAVIGATION_ENGINE.md`. Exercise interruption before and after record commits, action dispatch, and acknowledgement. Test duplicate messages, stale document identities, tab reload, service-worker restart, worker termination, cancellation, and replay. Verify record identity and checkpoint counts remain consistent. If an action's outcome is unknown, require a fresh page observation before another action.
