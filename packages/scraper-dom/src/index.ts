import { finder } from "@medv/finder"
import { hashRecordKey } from "@visual-scraper/core"
import type {
  ContentKind,
  ElementFingerprint,
  ExtractedRecord,
  FieldDefinition,
  FieldResult,
  HealingEvent,
  LocatorCandidate,
  LocatorPlan,
  NavigationAction,
  NavigationMode,
  ScraperDefinition,
} from "@visual-scraper/schema"

const SEMANTIC_ATTRIBUTES = [
  "data-testid",
  "data-test",
  "data-qa",
  "data-cy",
  "itemprop",
  "role",
  "aria-label",
  "name",
]
const BAD_ATTRIBUTE = /pass(word)?|token|secret|auth|cookie|session|credit|card|cvv|pin/i
const MAX_VALUE_LENGTH = 80

export function isStableToken(value: string): boolean {
  return (
    value.length > 0 &&
    value.length < 64 &&
    !/^(css-|sc-|emotion-|ember\d|radix-|headlessui-|react-aria|:r[0-9a-z]+:?$)/i.test(value) &&
    !/^[0-9a-f]{8,}$/i.test(value) &&
    !/^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(value) &&
    !/[0-9a-f]{10,}$/i.test(value) &&
    !/\d{5,}$/.test(value)
  )
}

function safeAttribute(name: string, value: string): boolean {
  return (
    !BAD_ATTRIBUTE.test(name) &&
    value.length <= MAX_VALUE_LENGTH &&
    !/\S+@\S+|\b\d{10,}\b/.test(value)
  )
}

function escapeIdentifier(value: string): string {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(value)
  return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${(char.codePointAt(0) ?? 0).toString(16)} `)
}

function attributeSelector(name: string, value: string): string {
  return `[${name}=${JSON.stringify(value)}]`
}

export function classifyValue(value: string, element?: Element): ContentKind {
  const text = value.trim()
  if (element?.tagName.toLowerCase() === "img") return "image"
  if (!text) return "unknown"
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return "email"
  if (/^https?:\/\//i.test(text)) return "url"
  if (/^[\p{Sc}]\s*[\d,.\s]+(?:\s*[A-Z]{3})?$|^[A-Z]{3}\s*[\d,.]+$/u.test(text)) return "currency"
  if (/^[+-]?[\d,.]+\s*%$/.test(text)) return "percentage"
  if (/^[+-]?\d+$/.test(text)) return "integer"
  if (/^[+-]?\d+[.,]\d+$/.test(text)) return "number"
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) return "datetime"
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return "date"
  if (/^\+?[\d\s().-]{9,}$/.test(text)) return "phone"
  if (/^(true|false|yes|no)$/i.test(text)) return "boolean"
  return "text"
}

function elementValueHint(element: Element): string {
  if (element instanceof HTMLImageElement)
    return element.currentSrc || element.src || element.getAttribute("data-src") || ""
  if (element instanceof HTMLAnchorElement) return element.href || ""
  return (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 100)
}

function stableClasses(element: Element): string[] {
  return Array.from(element.classList).filter(isStableToken).slice(0, 20)
}

function ancestors(element: Element, max = 8): Element[] {
  const result: Element[] = []
  let current: Element | null = element
  while (current && result.length < max) {
    result.push(current)
    current =
      current.parentElement ??
      (current.getRootNode() instanceof ShadowRoot
        ? (current.getRootNode() as ShadowRoot).host
        : null)
  }
  return result
}

export function fingerprint(element: Element): ElementFingerprint {
  const stableAttributes: Record<string, string> = {}
  if (element.id && isStableToken(element.id) && safeAttribute("id", element.id))
    stableAttributes.id = element.id
  for (const name of SEMANTIC_ATTRIBUTES) {
    const value = element.getAttribute(name)
    if (value && safeAttribute(name, value))
      stableAttributes[name] = value.slice(0, MAX_VALUE_LENGTH)
  }
  const siblings = element.parentElement
    ? Array.from(element.parentElement.children).filter(
        (child) => child.tagName === element.tagName,
      )
    : [element]
  const ancestorTags = ancestors(element, 7)
    .slice(1)
    .map((item) => item.tagName.toLowerCase())
  const childTags = Array.from(element.children)
    .slice(0, 30)
    .map((item) => item.tagName.toLowerCase())
  const nearbyLabels = Array.from(element.parentElement?.children ?? [])
    .filter((child) => child !== element)
    .map((child) =>
      (child.getAttribute("itemprop") || child.getAttribute("data-testid") || "").toLowerCase(),
    )
    .filter(Boolean)
    .slice(0, 8)
  return {
    tagName: element.tagName.toLowerCase(),
    stableAttributes,
    classes: stableClasses(element),
    ancestorTags,
    childTags,
    nearbyLabels,
    siblingTypeIndex: Math.max(0, siblings.indexOf(element)),
    depth: ancestors(element, 100).length,
    contentKind: classifyValue(elementValueHint(element), element),
  }
}

function overlap(left: string[], right: string[]): number {
  if (!left.length && !right.length) return 1
  if (!left.length || !right.length) return 0
  const a = new Map<string, number>()
  const b = new Map<string, number>()
  for (const value of left) a.set(value, (a.get(value) ?? 0) + 1)
  for (const value of right) b.set(value, (b.get(value) ?? 0) + 1)
  let common = 0
  for (const [value, count] of a) common += Math.min(count, b.get(value) ?? 0)
  return common / Math.max(left.length, right.length)
}

export function fingerprintSimilarity(
  reference: ElementFingerprint,
  candidate: ElementFingerprint,
): number {
  const sameTag = reference.tagName === candidate.tagName ? 1 : 0
  const sameKind =
    reference.contentKind === candidate.contentKind ||
    reference.contentKind === "unknown" ||
    candidate.contentKind === "unknown"
      ? 1
      : 0
  const attrs = Object.entries(reference.stableAttributes)
  const attrScore = attrs.length
    ? attrs.filter(([key, value]) => candidate.stableAttributes[key] === value).length /
      attrs.length
    : 1
  const classScore = overlap(reference.classes, candidate.classes)
  const siblingScore = reference.siblingTypeIndex === candidate.siblingTypeIndex ? 1 : 0.5
  return Math.min(
    1,
    sameTag * 0.22 +
      sameKind * 0.22 +
      overlap(reference.childTags, candidate.childTags) * 0.23 +
      overlap(reference.ancestorTags.slice(0, 3), candidate.ancestorTags.slice(0, 3)) * 0.15 +
      attrScore * 0.08 +
      classScore * 0.05 +
      siblingScore * 0.05,
  )
}

function query(root: ParentNode, selector: string): Element[] {
  try {
    if (root instanceof Element && root.matches(selector))
      return [root, ...root.querySelectorAll(selector)]
    return Array.from(root.querySelectorAll(selector))
  } catch {
    return []
  }
}

function pathToElementRoot(
  element: Element,
  base: ParentNode,
): {
  root: ParentNode
  path: LocatorPlan["contextPath"]
} {
  if (base instanceof Element && base.contains(element)) return { root: base, path: [] }
  const path: LocatorPlan["contextPath"] = []
  let current: ParentNode = element.getRootNode() as ParentNode
  while (current !== base) {
    if (current instanceof ShadowRoot) {
      const host = current.host
      const parent = host.getRootNode() as ParentNode
      const selector =
        candidateStrings(host).find(({ selector }) => query(parent, selector).includes(host))
          ?.selector ?? host.tagName.toLowerCase()
      path.unshift({ kind: "shadow", selector })
      current = parent
    } else if (current instanceof Document) {
      const frame = current.defaultView?.frameElement
      if (!frame) break
      const parent = frame.getRootNode() as ParentNode
      const selector =
        candidateStrings(frame).find(({ selector }) => query(parent, selector).includes(frame))
          ?.selector ?? frame.tagName.toLowerCase()
      path.unshift({ kind: "frame", selector })
      current = parent
    } else break
  }
  return { root: element.getRootNode() as ParentNode, path }
}

function candidateStrings(
  element: Element,
): Array<{ selector: string; source: LocatorCandidate["source"] }> {
  const tag = element.tagName.toLowerCase()
  const choices: Array<{ selector: string; source: LocatorCandidate["source"] }> = []
  for (const name of SEMANTIC_ATTRIBUTES) {
    const value = element.getAttribute(name)
    if (value && safeAttribute(name, value))
      choices.push({ selector: attributeSelector(name, value), source: "semantic" })
  }
  if (element.id && isStableToken(element.id))
    choices.push({ selector: `#${escapeIdentifier(element.id)}`, source: "semantic" })
  for (const cls of stableClasses(element).slice(0, 4)) {
    choices.push({ selector: `.${escapeIdentifier(cls)}`, source: "semantic" })
    choices.push({ selector: `${tag}.${escapeIdentifier(cls)}`, source: "semantic" })
  }
  choices.push({ selector: tag, source: "relative" })
  try {
    choices.push({
      selector: finder(element, {
        timeoutMs: 100,
        className: isStableToken,
        idName: isStableToken,
      }),
      source: "finder",
    })
  } catch {
    /* The bounded fallback candidates still apply. */
  }
  return choices.filter(
    (candidate, index, all) =>
      candidate.selector && all.findIndex((item) => item.selector === candidate.selector) === index,
  )
}

/** Generate candidates against the correct root. Fields may match once per record. */
export function generateLocator(
  element: Element,
  root: ParentNode,
  expectedMatchCount = 1,
): LocatorPlan {
  const reference = fingerprint(element)
  const context = pathToElementRoot(element, root)
  const searchRoot = context.path.length ? context.root : root
  const candidates = candidateStrings(element)
    .map(({ selector, source }): LocatorCandidate => {
      const matches = query(searchRoot, selector)
      const includes = matches.includes(element)
      const cardinality =
        matches.length === expectedMatchCount
          ? 1
          : Math.min(matches.length, expectedMatchCount) /
            Math.max(matches.length, expectedMatchCount, 1)
      const semantic = selector.includes("data-") || selector.includes("itemprop") ? 0.2 : 0
      const positional = /:nth-(?:child|of-type)/.test(selector) ? 0.25 : 0
      const complexity = Math.min(0.15, selector.split(/[ >+~]/).length * 0.03)
      const score = includes
        ? Math.max(0, Math.min(1, 0.55 + cardinality * 0.3 + semantic - positional - complexity))
        : 0
      return { selector, score, source }
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)
  const primary = candidates[0] ?? {
    selector: element.tagName.toLowerCase(),
    score: 0.2,
    source: "relative" as const,
  }
  return {
    contextPath: context.path,
    primarySelector: primary.selector,
    candidates: candidates.slice(0, 10),
    fingerprint: reference,
    confidence: primary.score,
  }
}

function resolveRoot(base: ParentNode, locator: LocatorPlan): ParentNode | null {
  let root: ParentNode | null = base
  for (const step of locator.contextPath) {
    const host: Element | undefined = root ? query(root, step.selector)[0] : undefined
    if (!host) return null
    if (step.kind === "shadow") root = host.shadowRoot
    else root = host instanceof HTMLIFrameElement ? host.contentDocument : null
  }
  return root
}

export interface ResolvedElement {
  element?: Element
  status: "success" | "missing" | "ambiguous"
  score: number
  selector?: string
  healed: boolean
}

export function resolveLocator(
  base: ParentNode,
  locator: LocatorPlan,
  healingThreshold = 0.9,
  margin = 0.1,
): ResolvedElement {
  const root = resolveRoot(base, locator)
  if (!root) return { status: "missing", score: 0, healed: false }
  const selectors = [
    locator.primarySelector,
    ...locator.candidates.map((candidate) => candidate.selector),
  ]
  for (const selector of new Set(selectors)) {
    const matches = query(root, selector)
      .map((element) => ({
        element,
        score: fingerprintSimilarity(locator.fingerprint, fingerprint(element)),
      }))
      .filter(({ score }) => score >= 0.55)
      .sort((a, b) => b.score - a.score)
    const best = matches[0]
    const runnerUp = matches[1]
    if (best && !runnerUp)
      return {
        ...best,
        status: "success",
        selector,
        healed: selector !== locator.primarySelector,
      }
    if (best && runnerUp && best.score - runnerUp.score >= margin) {
      return {
        ...best,
        status: "success",
        selector,
        healed: selector !== locator.primarySelector,
      }
    }
  }
  const all = root.querySelectorAll(locator.fingerprint.tagName)
  const ranked = Array.from(all)
    .slice(0, 2000)
    .map((element) => ({
      element,
      score: fingerprintSimilarity(locator.fingerprint, fingerprint(element)),
    }))
    .sort((a, b) => b.score - a.score)
  const best = ranked[0]
  if (!best || best.score < healingThreshold)
    return { status: "missing", score: best?.score ?? 0, healed: false }
  if (ranked[1] && best.score - ranked[1].score < margin)
    return { status: "ambiguous", score: best.score, healed: false }
  return { ...best, status: "success", healed: true }
}

function inferExtractionMode(element: Element): FieldDefinition["extractionMode"] {
  if (element instanceof HTMLImageElement) return "src"
  if (element instanceof HTMLAnchorElement) return "href"
  return "textContent"
}

export interface TrainingField {
  id?: string
  name: string
  element: Element
  groupId?: string
  extractionMode?: FieldDefinition["extractionMode"]
}

export interface InferenceCandidate {
  element: Element
  selector: string
  score: number
  matchCount: number
  reasons: string[]
}

function repeatedPeers(candidate: Element): Element[] {
  const parent = candidate.parentElement
  if (!parent) return [candidate]
  const fp = fingerprint(candidate)
  return Array.from(parent.children)
    .slice(0, 100)
    .filter((sibling) => fingerprintSimilarity(fp, fingerprint(sibling)) >= 0.65)
}

export function inferRecordCandidates(fields: TrainingField[]): InferenceCandidate[] {
  const first = fields[0]
  if (!first) return []
  const firstGroup = first.groupId ?? "default"
  const examples = fields.filter((field) => (field.groupId ?? "default") === firstGroup)
  const roots = ancestors(first.element).filter((candidate) =>
    examples.every((field) => candidate.contains(field.element)),
  )
  const ranked: InferenceCandidate[] = []
  for (const candidate of roots) {
    if (["html", "body", "main"].includes(candidate.tagName.toLowerCase())) continue
    const peers = repeatedPeers(candidate)
    if (peers.length < 2) continue
    const relativeLocators = examples.map((field) => generateLocator(field.element, candidate))
    let fieldCoverage = 0
    for (const peer of peers) {
      fieldCoverage += relativeLocators.filter(
        (locator) => resolveLocator(peer, locator, 0.95).status === "success",
      ).length
    }
    fieldCoverage /= peers.length * examples.length
    const similarity =
      peers.reduce(
        (sum, peer) => sum + fingerprintSimilarity(fingerprint(candidate), fingerprint(peer)),
        0,
      ) / peers.length
    const repetition = Math.min(1, peers.length / 10)
    const compactness = 1 / (1 + Math.max(0, candidate.querySelectorAll("*").length - 80) / 80)
    const score = Math.min(
      1,
      repetition * 0.23 + similarity * 0.25 + fieldCoverage * 0.4 + compactness * 0.12,
    )
    const selector = generateLocator(
      candidate,
      candidate.ownerDocument,
      peers.length,
    ).primarySelector
    ranked.push({
      element: candidate,
      selector,
      score,
      matchCount: peers.length,
      reasons: [
        `${peers.length} repeated peers`,
        `${Math.round(fieldCoverage * 100)}% field coverage`,
        `${Math.round(similarity * 100)}% structural similarity`,
      ],
    })
  }
  return ranked.sort((a, b) => b.score - a.score)
}

export function buildDefinition(
  fields: TrainingField[],
  name: string,
  startUrl: string,
  recordOverride?: Element,
): ScraperDefinition {
  const best = inferRecordCandidates(fields)[0]
  if (!recordOverride && (!best || best.score < 0.65)) {
    throw new Error("Record structure is ambiguous; select another example or a record container")
  }
  const recordElement = recordOverride ?? best?.element
  if (!recordElement) throw new Error("Record container not found")
  const matchCount = recordOverride ? repeatedPeers(recordOverride).length : (best?.matchCount ?? 1)
  const now = new Date().toISOString()
  const recordLocator = generateLocator(recordElement, recordElement.ownerDocument, matchCount)
  const definitions: FieldDefinition[] = fields.map((field) => ({
    id: field.id ?? crypto.randomUUID(),
    name: field.name,
    type: classifyValue(elementValueHint(field.element), field.element),
    optional: true,
    extractionMode: field.extractionMode ?? inferExtractionMode(field.element),
    locator: generateLocator(field.element, recordElement),
    transforms: ["trim", "collapseWhitespace"],
  }))
  const navigation =
    detectNavigation(recordElement.ownerDocument)[0] ??
    infiniteScrollAction(recordElement, recordElement.ownerDocument)
  return {
    version: 1,
    metadata: { id: crypto.randomUUID(), revision: 1, name, createdAt: now, updatedAt: now },
    scope: {
      startUrls: [startUrl],
      allowedOrigins: [new URL(startUrl).origin],
      allowedPathPatterns: [],
    },
    record: {
      locator: recordLocator,
      confidence: recordOverride ? 1 : (best?.score ?? 0),
      identityFieldIds: [],
    },
    fields: definitions,
    navigation: {
      mode: navigation?.mode ?? "none",
      candidateActions: navigation ? [navigation] : [],
      maxPages: 100,
      maxRecords: 10000,
      maxRuntimeMs: 1800000,
    },
    settings: {
      minActionIntervalMs: 1000,
      pageStabilityTimeoutMs: 15000,
      noProgressLimit: 3,
      healingThreshold: 0.9,
      healingMargin: 0.1,
      locale: "en-US",
      timezone: "UTC",
    },
  }
}

function normalizeValue(raw: string, kind: ContentKind): FieldResult["normalizedValue"] {
  const text = raw.trim()
  if (kind === "currency") {
    const amount = text.replace(/[^\d.,-]/g, "").replace(/,/g, "")
    const symbol = text.match(/[\p{Sc}]/u)?.[0]
    const code = text.match(/\b[A-Z]{3}\b/)?.[0]
    return amount ? { amount, ...(code || symbol ? { currency: code ?? symbol } : {}) } : text
  }
  if (kind === "integer" || kind === "number" || kind === "percentage") {
    const numeric = Number(text.replace(/,/g, "").replace(/%$/, ""))
    return Number.isFinite(numeric) ? numeric : text
  }
  if (kind === "boolean") return /^(true|yes)$/i.test(text)
  return text
}

function rawFieldValue(element: Element, field: FieldDefinition): string | null {
  if (element.closest("script,style,[hidden],input[type='hidden']")) return null
  if (
    element instanceof HTMLInputElement &&
    (/password|hidden|credit|card|cvv|payment/i.test(element.type) ||
      BAD_ATTRIBUTE.test(`${element.name} ${element.id} ${element.autocomplete}`))
  )
    return null
  const mode = field.extractionMode
  if (mode === "textContent") return element.textContent
  if (mode === "innerText") return (element as HTMLElement).innerText ?? element.textContent
  if (mode === "value") {
    if (
      !(element instanceof HTMLInputElement) ||
      /password|hidden|credit|card|cvv/i.test(element.type)
    )
      return null
    return element.value
  }
  if (mode === "attribute")
    return field.attribute &&
      !BAD_ATTRIBUTE.test(field.attribute) &&
      !(element instanceof HTMLInputElement && field.attribute === "value")
      ? element.getAttribute(field.attribute)
      : null
  if (mode === "href")
    return element instanceof HTMLAnchorElement ? element.href : element.getAttribute("href")
  if (mode === "src") {
    if (element instanceof HTMLImageElement)
      return element.currentSrc || element.src || element.getAttribute("data-src")
    return element.getAttribute("src") ?? element.getAttribute("data-src")
  }
  if (mode === "computedUrl") {
    const value =
      element.getAttribute("href") ??
      element.getAttribute("src") ??
      element.getAttribute("data-src")
    return value ? new URL(value, element.ownerDocument.baseURI).href : null
  }
  return element.getAttribute(mode)
}

export function extractField(
  record: Element,
  field: FieldDefinition,
  settings: ScraperDefinition["settings"],
): FieldResult {
  const resolved = resolveLocator(
    record,
    field.locator,
    settings.healingThreshold,
    settings.healingMargin,
  )
  if (!resolved.element)
    return {
      fieldId: field.id,
      status: resolved.status,
      rawValue: null,
      normalizedValue: null,
      reason:
        resolved.status === "ambiguous" ? "Several equally plausible nodes" : "No matching node",
    }
  const raw = rawFieldValue(resolved.element, field)
  if (raw === null || raw.trim() === "")
    return {
      fieldId: field.id,
      status: "missing",
      rawValue: raw,
      normalizedValue: null,
      sourceSelector: resolved.selector,
    }
  let value = raw
  for (const transform of field.transforms) {
    if (transform === "trim") value = value.trim()
    else if (transform === "collapseWhitespace") value = value.replace(/\s+/g, " ")
    else if (transform === "lowercase") value = value.toLowerCase()
    else if (transform === "uppercase") value = value.toUpperCase()
  }
  const kind = field.type === "unknown" ? classifyValue(value, resolved.element) : field.type
  return {
    fieldId: field.id,
    status: "success",
    rawValue: raw,
    normalizedValue: normalizeValue(value, kind),
    sourceSelector:
      resolved.selector ??
      (resolved.healed ? generateLocator(resolved.element, record).primarySelector : undefined),
    recoveryConfidence: resolved.healed ? resolved.score : undefined,
    reason: resolved.healed ? "Selector healed during this run" : undefined,
  }
}

function recordElements(
  doc: Document,
  definition: ScraperDefinition,
): { elements: Element[]; healed: boolean; selector?: string; confidence?: number } {
  const root = resolveRoot(doc, definition.record.locator)
  if (!root) return { elements: [], healed: false }
  const selectors = [
    definition.record.locator.primarySelector,
    ...definition.record.locator.candidates.map((candidate) => candidate.selector),
  ]
  for (const selector of new Set(selectors)) {
    const matches = query(root, selector).filter(
      (element) =>
        fingerprintSimilarity(definition.record.locator.fingerprint, fingerprint(element)) >=
        (selector === definition.record.locator.primarySelector
          ? 0.6
          : definition.settings.healingThreshold),
    )
    const first = matches[0]
    if (first)
      return {
        elements: matches.slice(0, definition.navigation.maxRecords),
        healed: selector !== definition.record.locator.primarySelector,
        selector,
        confidence: fingerprintSimilarity(
          definition.record.locator.fingerprint,
          fingerprint(first),
        ),
      }
  }
  const ranked = Array.from(root.querySelectorAll("article,li,section,div,[role='listitem']"))
    .slice(0, 2000)
    .filter((element) => element.children.length <= 30)
    .slice(0, 600)
    .map((element) => {
      const similarity = fingerprintSimilarity(
        definition.record.locator.fingerprint,
        fingerprint(element),
      )
      if (similarity < 0.5) return { element, score: 0 }
      const sampledFields = definition.fields.slice(0, 4)
      const coverage =
        sampledFields.filter(
          (field) =>
            resolveLocator(
              element,
              field.locator,
              definition.settings.healingThreshold,
              definition.settings.healingMargin,
            ).status === "success",
        ).length / Math.max(sampledFields.length, 1)
      const repetition = Math.min(1, (repeatedPeers(element).length - 1) / 4)
      return { element, score: similarity * 0.25 + coverage * 0.6 + repetition * 0.15 }
    })
    .filter((candidate) => candidate.score >= definition.settings.healingThreshold)
    .sort((a, b) => b.score - a.score)
  const best = ranked[0]
  const bestFingerprint = best ? fingerprint(best.element) : undefined
  const elements = best
    ? ranked
        .filter(
          (candidate) =>
            candidate.element.parentElement === best.element.parentElement &&
            bestFingerprint !== undefined &&
            fingerprintSimilarity(bestFingerprint, fingerprint(candidate.element)) >= 0.7,
        )
        .map((candidate) => candidate.element)
        .slice(0, definition.navigation.maxRecords)
    : []
  return {
    elements,
    healed: elements.length > 0,
    selector: elements[0]
      ? generateLocator(elements[0], doc, elements.length).primarySelector
      : undefined,
    confidence: best?.score,
  }
}

export interface ExtractionObservation {
  url: string
  records: ExtractedRecord[]
  navigation: NavigationAction[]
  stateSignature: string
  healedFields: number
  healedRecords: number
  healingEvents: Array<Omit<HealingEvent, "timestamp">>
}

function infiniteScrollAction(
  record: Element | undefined,
  doc: Document,
): NavigationAction | undefined {
  if (!record) return undefined
  let ancestor = record.parentElement
  for (let depth = 0; ancestor && depth < 8; depth++, ancestor = ancestor.parentElement) {
    if (
      ancestor.scrollHeight > ancestor.clientHeight + 100 &&
      ancestor.clientHeight > 100 &&
      /auto|scroll/.test(doc.defaultView?.getComputedStyle(ancestor).overflowY ?? "")
    ) {
      return {
        mode: "infinite-scroll",
        confidence: 0.86,
        label: "Scrollable results container",
        locator: generateLocator(ancestor, doc),
      }
    }
  }
  if (doc.documentElement.scrollHeight > (doc.defaultView?.innerHeight ?? 0) + 100) {
    return { mode: "infinite-scroll", confidence: 0.86, label: "Scrollable result page" }
  }
  return undefined
}

export function extractPage(
  definition: ScraperDefinition,
  doc: Document = document,
): ExtractionObservation {
  const records: ExtractedRecord[] = []
  let healedFields = 0
  const found = recordElements(doc, definition)
  const healingEvents = new Map<string, Omit<HealingEvent, "timestamp">>()
  if (found.healed && found.selector)
    healingEvents.set("record", {
      kind: "record",
      oldSelector: definition.record.locator.primarySelector,
      newSelector: found.selector,
      confidence: found.confidence ?? 0,
    })
  for (const element of found.elements) {
    const fields = definition.fields.map((field) =>
      extractField(element, field, definition.settings),
    )
    healedFields += fields.filter(
      (field) => field.reason === "Selector healed during this run",
    ).length
    for (const field of fields) {
      if (field.reason !== "Selector healed during this run" || !field.sourceSelector) continue
      const source = definition.fields.find((item) => item.id === field.fieldId)
      if (!source) continue
      healingEvents.set(`${source.id}:${field.sourceSelector}`, {
        kind: "field",
        fieldId: source.id,
        oldSelector: source.locator.primarySelector,
        newSelector: field.sourceSelector,
        confidence: field.recoveryConfidence ?? 0,
      })
    }
    if (fields.every((field) => field.status !== "success")) continue
    records.push({ hash: "", sourceUrl: doc.location?.href ?? doc.baseURI, fields })
  }
  const signature = hashRecordKey(
    JSON.stringify([
      doc.location?.href ?? doc.baseURI,
      records.length,
      records.slice(-10).map((record) => record.fields.map((field) => field.rawValue)),
    ]),
  )
  const navigation = detectNavigation(doc)
  if (!navigation.length && records.length >= 5) {
    const action = infiniteScrollAction(found.elements[0], doc)
    if (action) navigation.push(action)
  }
  if (
    definition.navigation.mode === "infinite-scroll" &&
    !navigation.some((action) => action.mode === "infinite-scroll")
  ) {
    navigation.push({
      mode: "infinite-scroll",
      confidence: 0.9,
      label: "Configured infinite scroll",
    })
  }
  return {
    url: doc.location?.href ?? doc.baseURI,
    records,
    navigation,
    stateSignature: signature,
    healedFields,
    healedRecords: found.healed ? found.elements.length : 0,
    healingEvents: [...healingEvents.values()],
  }
}

const DESTRUCTIVE = /delete|remove|pay|purchase|checkout|submit|login|sign in|download|logout/i
const PREVIOUS = /previous|prev|back|older/i

function navigationLabel(element: Element): string {
  return [element.getAttribute("aria-label"), element.getAttribute("title"), element.textContent]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100)
}

function navigationMode(element: Element): { mode: NavigationMode; confidence: number } | null {
  const label = navigationLabel(element).toLowerCase()
  if (DESTRUCTIVE.test(label) || PREVIOUS.test(label)) return null
  if (element.matches(":disabled, [aria-disabled='true']")) return null
  if (element.closest("form") && element.getAttribute("type") === "submit") return null
  if (element.getAttribute("rel") === "next") return { mode: "next-button", confidence: 0.99 }
  if (/\b(load more|show more|more results|view more)\b/.test(label))
    return { mode: "load-more", confidence: 0.92 }
  if (/\b(next|next page|forward|continue)\b/.test(label) || /^[>›»]$/.test(label.trim())) {
    return {
      mode: "next-button",
      confidence: element.closest("nav,[class*='pagination']") ? 0.94 : 0.86,
    }
  }
  if (/^\d+$/.test(label) && element.closest("nav,[class*='pagination']")) {
    const active = element
      .closest("nav,[class*='pagination']")
      ?.querySelector("[aria-current='page']")
    const current = Number(active?.textContent?.trim())
    if (
      element.hasAttribute("aria-current") ||
      (Number.isFinite(current) && Number(label) <= current)
    )
      return null
    return { mode: "numbered-pagination", confidence: 0.86 }
  }
  return null
}

export function detectNavigation(doc: Document = document): NavigationAction[] {
  const candidates: NavigationAction[] = []
  const current = new URL(doc.location?.href ?? doc.baseURI)
  for (const element of Array.from(doc.querySelectorAll("a,button,[role='button']")).slice(
    0,
    1000,
  )) {
    const detected = navigationMode(element)
    if (!detected) continue
    candidates.push({
      ...detected,
      label: navigationLabel(element),
      locator: generateLocator(element, doc),
    })
    if (element instanceof HTMLAnchorElement && element.closest("nav,[class*='pagination']")) {
      const target = new URL(element.href, doc.baseURI)
      const key = ["page", "p"].find(
        (name) =>
          /^\d+$/.test(current.searchParams.get(name) ?? "") &&
          /^\d+$/.test(target.searchParams.get(name) ?? "") &&
          Number(target.searchParams.get(name)) === Number(current.searchParams.get(name)) + 1,
      )
      if (key && target.origin === current.origin)
        candidates.push({
          mode: "url-pagination",
          confidence: 0.9,
          label: `URL ${key}=${target.searchParams.get(key)}`,
          urlTemplate: target.href,
        })
    }
  }
  return candidates
    .sort(
      (a, b) =>
        b.confidence - a.confidence ||
        (a.mode === "numbered-pagination" && b.mode === "numbered-pagination"
          ? Number(a.label) - Number(b.label)
          : 0),
    )
    .slice(0, 20)
}

export function executeNavigation(
  action: NavigationAction,
  doc: Document = document,
  allowedOrigins: string[] = [doc.location?.origin ?? new URL(doc.baseURI).origin],
): boolean {
  if (action.mode === "infinite-scroll") {
    const target = action.locator ? resolveLocator(doc, action.locator, 0.7).element : undefined
    if (target)
      target.scrollTop = Math.min(target.scrollHeight, target.scrollTop + target.clientHeight * 0.8)
    else doc.defaultView?.scrollTo(0, doc.documentElement.scrollHeight)
    return true
  }
  if (action.mode === "url-pagination" && action.urlTemplate) {
    const target = new URL(action.urlTemplate, doc.baseURI)
    if (!allowedOrigins.includes(target.origin)) return false
    doc.defaultView?.location.assign(target.href)
    return true
  }
  if (!action.locator) return false
  const resolved = resolveLocator(doc, action.locator, 0.9, 0.1)
  if (!resolved.element || navigationMode(resolved.element)?.mode !== action.mode) return false
  if (
    resolved.element instanceof HTMLAnchorElement &&
    !allowedOrigins.includes(new URL(resolved.element.href, doc.baseURI).origin)
  )
    return false
  if (resolved.element instanceof HTMLElement) {
    resolved.element.click()
    return true
  }
  return false
}

export async function waitForPageChange(
  previousSignature: string,
  timeoutMs: number,
  definition: ScraperDefinition,
  doc: Document = document,
): Promise<boolean> {
  const started = Date.now()
  return new Promise((resolve) => {
    let settled = false
    const finish = (changed: boolean) => {
      if (settled) return
      settled = true
      observer.disconnect()
      clearInterval(timer)
      resolve(changed)
    }
    const check = () => {
      if (extractPage(definition, doc).stateSignature !== previousSignature) finish(true)
      else if (Date.now() - started >= timeoutMs) finish(false)
    }
    const observer = new MutationObserver(check)
    observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true })
    const timer = setInterval(check, 250)
    check()
  })
}
