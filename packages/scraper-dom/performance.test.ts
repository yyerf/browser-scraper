// @vitest-environment jsdom
import { beforeEach, expect, test } from "vitest"
import { inferRecordCandidates } from "./src/index"

beforeEach(() => {
  document.body.innerHTML = ""
})

test("record inference stays bounded on a 10,000-node fixture", () => {
  const cards = Array.from(
    { length: 100 },
    (_, index) =>
      `<article data-testid="record"><h2>Product ${index}</h2><span itemprop="price">$${index + 1}</span>${"<i></i>".repeat(
        98,
      )}</article>`,
  ).join("")
  document.body.innerHTML = `<main><section>${cards}</section></main>`
  expect(document.querySelectorAll("*").length).toBeGreaterThan(10000)
  const first = document.querySelector("article")
  if (!first) throw new Error("Fixture failed")
  const name = first.querySelector("h2")
  const price = first.querySelector("[itemprop='price']")
  if (!name || !price) throw new Error("Fixture fields failed")
  const started = performance.now()
  const candidates = inferRecordCandidates([
    { name: "Name", element: name },
    { name: "Price", element: price },
  ])
  expect(candidates[0]?.matchCount).toBe(100)
  expect(performance.now() - started).toBeLessThan(10000)
}, 15000)
