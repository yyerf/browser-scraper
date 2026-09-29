// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest"
import {
  buildDefinition,
  extractField,
  extractPage,
  fingerprint,
  fingerprintSimilarity,
  generateLocator,
  inferRecordCandidates,
  isStableToken,
} from "./index"

function productPage(priceClass = "price", wrapper = false): void {
  document.body.innerHTML = `<main><section class="catalog">${Array.from(
    { length: 20 },
    (_, index) => {
      const price = `<span class="${priceClass}">$${100 + index}</span>`
      return `<article class="product-card" data-testid="product-card"><h2 class="name">Product ${index + 1}</h2>${wrapper ? `<div class="new-wrapper">${price}</div>` : price}<span class="rating">${(4 + index / 100).toFixed(2)}</span><img alt="Product ${index + 1}" src="/image-${index + 1}.png"></article>`
    },
  ).join("")}</section><nav><a rel="next" href="/page/2">Next</a></nav></main>`
}

function required(root: ParentNode, selector: string): Element {
  const element = root.querySelector(selector)
  if (!element) throw new Error(`Fixture element missing: ${selector}`)
  return element
}

function examples() {
  const first = required(document, "article")
  return [
    { name: "Name", element: required(first, "h2") },
    { name: "Price", element: required(first, ".price") },
    { name: "Rating", element: required(first, ".rating") },
    { name: "Image", element: required(first, "img") },
  ]
}

describe("portable record inference", () => {
  beforeEach(() => {
    productPage()
  })

  it("rejects generated classes and selects the repeated card", () => {
    expect(isStableToken("css-1abcxyz")).toBe(false)
    expect(isStableToken("sc-aBc123")).toBe(false)
    expect(isStableToken("product-card")).toBe(true)
    const inferred = inferRecordCandidates(examples())
    expect(inferred[0]?.element.tagName).toBe("ARTICLE")
    expect(inferred[0]?.matchCount).toBe(20)
  })

  it("extracts all cards with field selectors relative to the record", () => {
    const definition = buildDefinition(examples(), "Products", "https://fixture.test/page/1")
    expect(definition.record.locator.primarySelector).toContain("product-card")
    expect(
      definition.fields.find((field) => field.name === "Price")?.locator.primarySelector,
    ).toContain("price")
    const observation = extractPage(definition)
    expect(observation.records).toHaveLength(20)
    expect(observation.records[0]?.fields.map((field) => field.rawValue)).toEqual([
      "Product 1",
      "$100",
      "4.00",
      expect.stringContaining("image-1.png"),
    ])
    expect(observation.navigation[0]?.mode).toBe("next-button")
  })

  it("heals a renamed price class and added wrapper without taking the rating", () => {
    const definition = buildDefinition(examples(), "Products", "https://fixture.test/page/1")
    productPage("current-price", true)
    const observation = extractPage(definition)
    const price = observation.records[0]?.fields.find(
      (field) => field.fieldId === definition.fields[1]?.id,
    )
    expect(observation.records).toHaveLength(20)
    expect(price?.rawValue).toBe("$100")
    expect(price?.reason).toBe("Selector healed during this run")
    expect(observation.healingEvents).toHaveLength(1)
    expect(observation.healingEvents[0]).toMatchObject({
      kind: "field",
      fieldId: definition.fields[1]?.id,
      oldSelector: definition.fields[1]?.locator.primarySelector,
      newSelector: expect.any(String),
    })
    expect(observation.healingEvents[0]?.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it("scores a slightly changed structure as similar", () => {
    const original = required(document, "article")
    const changed = original.cloneNode(true) as Element
    changed.insertAdjacentHTML("afterbegin", "<span class='badge'>New</span>")
    expect(fingerprintSimilarity(fingerprint(original), fingerprint(changed))).toBeGreaterThan(0.75)
  })

  it("recovers repeated record containers after their tag and class change", () => {
    const definition = buildDefinition(examples(), "Products", "https://fixture.test/page/1")
    document.querySelectorAll("article.product-card").forEach((card) => {
      const replacement = document.createElement("div")
      replacement.className = "catalog-item"
      replacement.innerHTML = card.innerHTML
      card.replaceWith(replacement)
    })
    const observation = extractPage(definition)
    expect(observation.records).toHaveLength(20)
    expect(observation.healingEvents).toEqual([
      expect.objectContaining({
        kind: "record",
        oldSelector: definition.record.locator.primarySelector,
        newSelector: expect.any(String),
      }),
    ])
    expect(observation.healingEvents[0]?.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it("never extracts password inputs even when an attribute mode is configured", () => {
    const definition = buildDefinition(examples(), "Products", "https://fixture.test/page/1")
    const record = required(document, "article")
    record.insertAdjacentHTML(
      "beforeend",
      "<input type='password' value='SECRET' name='login-password'>",
    )
    const input = required(record, "input")
    const source = definition.fields[0]
    if (!source) throw new Error("Fixture field missing")
    const field = {
      ...source,
      extractionMode: "attribute" as const,
      attribute: "value",
      locator: generateLocator(input, record),
    }
    expect(extractField(record, field, definition.settings).rawValue).toBeNull()
  })
})
