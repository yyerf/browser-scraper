# Navigation engine

The DOM engine ranks `rel=next`, semantic Next labels, Load More labels, and numbered links in pagination regions. It rejects disabled, previous/back, and destructive actions. For numbered pagination it skips the current and earlier numbers. It can propose an exact next URL when a numbered query parameter advances by one. It checks target origins before acting. If no explicit action is found and the record area can scroll, it proposes bounded infinite scrolling. The inspector lets a user choose the mode or select a navigation action.

After each action, `RunController` waits for a change in URL or extracted record signature. It commits records and a checkpoint, deduplicates by content, and stops on end of list, no progress, maximum pages, maximum records, maximum runtime, or navigation-attempt limit. Infinite scrolling uses a shorter change wait and checks the nearest scroll container or document. SPA routes count as progress when URL or records change.

The current worker executes a stateful journey in one Crawlee request per start URL, with Crawlee handling browser creation and retries. Future hardening should persist a navigation receipt and resolve an unknown action outcome before retrying after a crash.
