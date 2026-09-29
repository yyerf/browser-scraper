# Privacy and permissions

Visual Scraper is local-first. It has no backend, analytics, or required AI provider. Definitions live in extension storage, datasets/checkpoints in extension IndexedDB, and worker datasets/profiles in local files. No page content is sent to an external service by default.

The picker and fingerprint engine filter attributes suggesting passwords, tokens, cookies, payment data, or other sensitive values. They do not persist `HTMLElement` references or form values by default. The worker requires a separate manually authenticated profile; it does not copy the extension browser's cookies. The extension does not implement CAPTCHA solving, access-control bypass, or anti-bot evasion.

The Chromium manifest uses `storage`, `scripting`, `tabs`, and `activeTab`. `storage` saves definitions; `scripting` injects the inspector when activated; `tabs` locates the target tab and recovers from full navigation; `activeTab` covers the active page interaction. HTTP(S) origins are optional host permissions requested only after a user starts scraping on that site. The generated manifest should be reviewed before packaging because build tooling may add web-accessible UI CSS resources.

Exports include only configured fields. Users should verify that extraction fields are appropriate for the site and their permissions. Worker profiles and SQLite files are ignored by Git and should be protected like other local browser data.
