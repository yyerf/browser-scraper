import { z } from "zod"

const score = z.number().min(0).max(1)
const safeUrl = z
  .url()
  .refine((value) => /^https?:\/\//i.test(value), "Only HTTP(S) URLs are supported")

export const contentKindSchema = z.enum([
  "text",
  "currency",
  "integer",
  "number",
  "percentage",
  "date",
  "datetime",
  "url",
  "image",
  "email",
  "phone",
  "boolean",
  "unknown",
])

export const contextStepSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("frame"), selector: z.string().min(1) }),
  z.object({ kind: z.literal("shadow"), selector: z.string().min(1) }),
])

export const fingerprintSchema = z.object({
  tagName: z.string().min(1),
  stableAttributes: z.record(z.string(), z.string()),
  classes: z.array(z.string()).max(20),
  ancestorTags: z.array(z.string()).max(10),
  childTags: z.array(z.string()).max(30),
  nearbyLabels: z.array(z.string()).max(8),
  siblingTypeIndex: z.number().int().nonnegative(),
  depth: z.number().int().nonnegative(),
  contentKind: contentKindSchema,
})

export const locatorCandidateSchema = z.object({
  selector: z.string().min(1).max(1000),
  score,
  source: z.enum(["finder", "semantic", "relative", "manual", "healed"]),
})

export const locatorPlanSchema = z.object({
  contextPath: z.array(contextStepSchema).max(10).default([]),
  primarySelector: z.string().min(1).max(1000),
  candidates: z.array(locatorCandidateSchema).max(20),
  fingerprint: fingerprintSchema,
  confidence: score,
})

export const fieldSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  type: contentKindSchema,
  optional: z.boolean().default(true),
  extractionMode: z.enum([
    "textContent",
    "innerText",
    "href",
    "src",
    "srcset",
    "alt",
    "title",
    "value",
    "attribute",
    "computedUrl",
  ]),
  attribute: z.string().max(100).optional(),
  locator: locatorPlanSchema,
  transforms: z
    .array(z.enum(["trim", "collapseWhitespace", "lowercase", "uppercase"]))
    .max(4)
    .default(["trim", "collapseWhitespace"]),
})

export const navigationModeSchema = z.enum([
  "none",
  "next-button",
  "numbered-pagination",
  "load-more",
  "infinite-scroll",
  "url-pagination",
])

export const navigationActionSchema = z.object({
  mode: navigationModeSchema,
  locator: locatorPlanSchema.optional(),
  confidence: score,
  label: z.string().max(100).optional(),
  urlTemplate: z.string().max(1000).optional(),
})

export const scraperDefinitionSchema = z
  .object({
    version: z.literal(1),
    metadata: z.object({
      id: z.string().min(1),
      revision: z.number().int().positive(),
      name: z.string().min(1).max(120),
      createdAt: z.iso.datetime(),
      updatedAt: z.iso.datetime(),
    }),
    scope: z.object({
      startUrls: z.array(safeUrl).min(1).max(20),
      allowedOrigins: z.array(safeUrl).min(1).max(20),
      allowedPathPatterns: z.array(z.string().max(200)).max(20).default([]),
    }),
    record: z.object({
      locator: locatorPlanSchema,
      confidence: score.default(0),
      identityFieldIds: z.array(z.string()).default([]),
    }),
    fields: z.array(fieldSchema).min(1).max(50),
    navigation: z.object({
      mode: navigationModeSchema,
      candidateActions: z.array(navigationActionSchema).max(20).default([]),
      maxPages: z.number().int().min(1).max(1000).default(100),
      maxRecords: z.number().int().min(1).max(100000).default(10000),
      maxRuntimeMs: z.number().int().min(1000).max(86400000).default(1800000),
    }),
    settings: z.object({
      minActionIntervalMs: z.number().int().min(0).max(60000).default(1000),
      pageStabilityTimeoutMs: z.number().int().min(100).max(120000).default(15000),
      noProgressLimit: z.number().int().min(1).max(20).default(3),
      healingThreshold: score.default(0.9),
      healingMargin: score.default(0.1),
      locale: z.string().default("en-US"),
      timezone: z.string().default("UTC"),
    }),
  })
  .superRefine((value, ctx) => {
    const ids = new Set<string>()
    for (const [index, field] of value.fields.entries()) {
      if (ids.has(field.id))
        ctx.addIssue({
          code: "custom",
          path: ["fields", index, "id"],
          message: "Duplicate field ID",
        })
      ids.add(field.id)
      if (field.extractionMode === "attribute" && !field.attribute) {
        ctx.addIssue({
          code: "custom",
          path: ["fields", index, "attribute"],
          message: "Attribute name required",
        })
      }
    }
    for (const id of value.record.identityFieldIds) {
      if (!ids.has(id))
        ctx.addIssue({
          code: "custom",
          path: ["record", "identityFieldIds"],
          message: `Unknown identity field ${id}`,
        })
    }
    const origins = new Set(value.scope.allowedOrigins)
    for (const [index, url] of value.scope.startUrls.entries()) {
      if (!origins.has(new URL(url).origin))
        ctx.addIssue({
          code: "custom",
          path: ["scope", "startUrls", index],
          message: "Start URL origin is outside scope",
        })
    }
  })

export const fieldStatusSchema = z.enum(["success", "missing", "ambiguous", "invalid", "error"])
export const normalizedValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.object({ amount: z.string(), currency: z.string().optional() }),
])
export const fieldResultSchema = z.object({
  fieldId: z.string(),
  status: fieldStatusSchema,
  rawValue: z.string().nullable(),
  normalizedValue: normalizedValueSchema,
  sourceSelector: z.string().optional(),
  recoveryConfidence: score.optional(),
  reason: z.string().optional(),
})
export const extractedRecordSchema = z.object({
  hash: z.string(),
  sourceUrl: safeUrl,
  fields: z.array(fieldResultSchema),
})

export const runStateSchema = z.enum([
  "idle",
  "initializing",
  "extracting",
  "waiting",
  "navigating",
  "paused",
  "completed",
  "cancelled",
  "failed",
])
export const healingEventSchema = z.object({
  kind: z.enum(["field", "record"]),
  fieldId: z.string().optional(),
  oldSelector: z.string().max(1000),
  newSelector: z.string().max(1000),
  confidence: score,
  timestamp: z.iso.datetime(),
})
export const runCheckpointSchema = z.object({
  runId: z.string(),
  definitionId: z.string(),
  definitionRevision: z.number().int().positive(),
  startedAt: z.iso.datetime().optional(),
  state: runStateSchema,
  pageCount: z.number().int().nonnegative(),
  recordCount: z.number().int().nonnegative(),
  duplicateCount: z.number().int().nonnegative(),
  healingCount: z.number().int().nonnegative().default(0),
  healingEvents: z.array(healingEventSchema).max(100).default([]),
  currentUrl: safeUrl,
  epoch: z.number().int().nonnegative(),
  navigationAttempts: z.number().int().nonnegative().default(0),
  noProgressCount: z.number().int().nonnegative().default(0),
  recentStateSignatures: z.array(z.string()).max(100).default([]),
  pendingActionId: z.string().optional(),
  stopReason: z.string().optional(),
  updatedAt: z.iso.datetime(),
})

export type ContentKind = z.infer<typeof contentKindSchema>
export type ElementFingerprint = z.infer<typeof fingerprintSchema>
export type LocatorCandidate = z.infer<typeof locatorCandidateSchema>
export type LocatorPlan = z.infer<typeof locatorPlanSchema>
export type FieldDefinition = z.infer<typeof fieldSchema>
export type NavigationAction = z.infer<typeof navigationActionSchema>
export type NavigationMode = z.infer<typeof navigationModeSchema>
export type ScraperDefinition = z.infer<typeof scraperDefinitionSchema>
export type FieldResult = z.infer<typeof fieldResultSchema>
export type ExtractedRecord = z.infer<typeof extractedRecordSchema>
export type RunCheckpoint = z.infer<typeof runCheckpointSchema>
export type HealingEvent = z.infer<typeof healingEventSchema>
export type RunState = z.infer<typeof runStateSchema>
