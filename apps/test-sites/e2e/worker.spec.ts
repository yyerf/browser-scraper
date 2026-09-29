import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { expect, test } from "@playwright/test"

const run = promisify(execFile)

test("worker parity: shared definition yields 60 records", async () => {
  const { stdout } = await run(process.execPath, ["apps/test-sites/worker-e2e.mjs"], {
    timeout: 120000,
    maxBuffer: 1024 * 1024,
  })
  expect(stdout).toContain("60 unique records")
})
