import { buildDefinition, executeNavigation, extractPage, waitForPageChange } from "./index"

/** Bundled into the worker page; the extension imports the same source modules. */
Object.assign(globalThis, {
  __visualScraperRuntime: { buildDefinition, executeNavigation, extractPage, waitForPageChange },
})
