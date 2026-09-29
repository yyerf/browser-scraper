# Third-party notices

## OpenPicker

Source: [usertour/openpicker](https://github.com/usertour/openpicker), revision `45a2f624d3cdfcd6841a9876f03a5c58b1e344f9`. The picker UI, protocol package, selector-rules UI, WXT scaffold, icons/fonts configuration, and associated tests were copied and adapted. OpenPicker is MIT licensed. Its copyright and permission notice are preserved in the repository [LICENSE](LICENSE). The protocol package also retains upstream metadata. This repository adds its own scraper engine and application code on top of that base.

## Other foundations

- [`@medv/finder`](https://github.com/antonmedv/finder): selector candidate generation, MIT license, used as a package dependency.
- [Crawlee](https://github.com/apify/crawlee): worker browser lifecycle and retry, Apache-2.0 license, used as a package dependency.
- [Playwright](https://github.com/microsoft/playwright): browser automation for the worker and tests, Apache-2.0 license, used as a package dependency.
- [AutoScraper](https://github.com/alirezamika/autoscraper): conceptual study of example-driven rule induction; no source code copied.
- [Automa](https://github.com/AutomaApp/automa): architectural reference only; no implementation copied.

Other runtime and development packages retain their own license notices in their distributed package metadata. Verify dependency license reports before public distribution.
