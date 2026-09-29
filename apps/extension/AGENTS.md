# Extension ownership

- Keep the picker isolated in Shadow DOM, and intercept selection gestures before website handlers activate them.
- Keep datasets and checkpoints in extension-owned IndexedDB. Content scripts send bounded messages and retain only transient DOM references.
- Test behavior in Chromium and Firefox MV3. Check reloads, permission loss, navigation, and stale messages.
- Request access to website origins only when the user activates scraping there. Do not expose scraper commands to website scripts.
- Treat the current browser session as the source of the user's existing website authentication; never export cookies or credentials.
