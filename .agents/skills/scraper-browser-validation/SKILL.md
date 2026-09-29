---
name: scraper-browser-validation
description: Validate Visual Scraper extension changes in real Chromium and Firefox builds.
---

Build both MV3 targets. Load the extension into Playwright Chromium and temporary-install it through Selenium/Geckodriver in Firefox. Run the same fixture scenarios and inspect actual user-visible records, navigation, exports, and saved reruns. Capture precise reproduction steps and browser versions for failures. Do not substitute a jsdom test for a browser permission or lifecycle test.
