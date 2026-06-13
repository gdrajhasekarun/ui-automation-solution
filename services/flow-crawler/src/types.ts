import { z } from 'zod'

// ── Request payload ────────────────────────────────────────────────────────────
// Mirrors crawl-ai's POST /trigger body + CrawlAiConfigSchema fields.
export const RequestPayloadSchema = z.object({
  app_id:         z.string().default('app'),
  app_url:        z.string().url(),
  excel_path:     z.string().optional(),
  framework_dir:  z.string().optional(),
  target_tool:    z.string().optional(),
  max_pages:      z.number().default(60),
  max_depth:      z.number().default(10),
  headless:       z.boolean().default(true),
  target_flows:   z.array(z.string()).default([]),
  allowed_domain: z.string().optional(),
  llm_enabled:    z.boolean().default(true),
  output_dir:     z.string().optional(),
})

export type RequestPayload = z.infer<typeof RequestPayloadSchema>

// ── Component library detection ────────────────────────────────────────────────
export const UILibrarySchema = z.enum([
  'material', 'ionic', 'antd', 'chakra', 'bootstrap',
  'tailwind', 'shadcn', 'vuetify', 'unknown',
])
export type UILibrary = z.infer<typeof UILibrarySchema>

// ── Element capture ────────────────────────────────────────────────────────────
export const ElementTypeSchema = z.enum([
  'textbox', 'textarea', 'radio', 'checkbox', 'button',
  'link', 'tab', 'select', 'combobox', 'toggle', 'other',
])
export type ElementType = z.infer<typeof ElementTypeSchema>

export const BoundingBoxSchema = z.object({
  x: z.number(), y: z.number(), width: z.number(), height: z.number(),
})
export type BoundingBox = z.infer<typeof BoundingBoxSchema>

export const CapturedElementSchema = z.object({
  id:               z.string(),
  tag:              z.string(),
  elementType:      ElementTypeSchema,
  role:             z.string().nullable(),
  name:             z.string(),
  label:            z.string().nullable(),
  placeholder:      z.string().nullable(),
  required:         z.boolean(),
  visible:          z.boolean(),
  blocked:          z.boolean(),
  blockingElement:  z.string().nullable(),
  boundingBox:      BoundingBoxSchema.nullable(),
  uiLibrary:        UILibrarySchema,
  libraryComponent: z.string().nullable(),
  interactionKey:   z.string().nullable(),
  fillSource:       z.enum(['excel','notes','static','llm','cache','skip']).nullable(),
  fillConfidence:   z.number().nullable(),
  href:             z.string().nullable().optional(),
  inputType:        z.string().nullable().optional(),
  // Internal — not serialised to graph
  _selector:        z.string().optional(),
  _resolvedValue:   z.string().nullable().optional(),
})
export type CapturedElement = z.infer<typeof CapturedElementSchema>

// ── Crawl data cache ───────────────────────────────────────────────────────────
export const CachedInteractionSchema = z.object({
  key:         z.string(),
  value:       z.string(),
  source:      z.enum(['excel','llm']),
  confidence:  z.number().nullable(),
  elementType: ElementTypeSchema,
  usageCount:  z.number().default(1),
  lastUsed:    z.string(),
})
export type CachedInteraction = z.infer<typeof CachedInteractionSchema>

export const CrawlDataSchema = z.object({
  version:      z.string().default('1'),
  interactions: z.record(z.string(), CachedInteractionSchema),
})
export type CrawlData = z.infer<typeof CrawlDataSchema>

// ── Interaction decision ───────────────────────────────────────────────────────
export const InteractionDecisionSchema = z.object({
  elementId:   z.string(),
  elementType: ElementTypeSchema,
  action:      z.enum(['fill','click','select','skip']),
  value:       z.string().nullable(),
  key:         z.string().nullable(),
  source:      z.enum(['excel','notes','static','llm','cache','skip']),
})
export type InteractionDecision = z.infer<typeof InteractionDecisionSchema>

// ── Path record — for Phase B re-trace ────────────────────────────────────────
export const PathStepSchema = z.object({
  nodeId:   z.string(),
  url:      z.string(),
  decision: InteractionDecisionSchema,
})
export type PathStep = z.infer<typeof PathStepSchema>

export const PathRecordSchema = z.object({
  pathId:   z.string(),
  steps:    z.array(PathStepSchema),
  complete: z.boolean(),
})
export type PathRecord = z.infer<typeof PathRecordSchema>

// ── Branch (divergence point) ──────────────────────────────────────────────────
export interface Branch {
  pathId:         string
  divergeNodeId:  string
  divergeStepIdx: number
  altValue:       string
  altKey:         string | null
  elementId:      string
  steps:          PathStep[]
}

// ── Graph ──────────────────────────────────────────────────────────────────────
export const UnfilledFieldSchema = z.object({
  elementId:  z.string(),
  key:        z.string(),
  reason:     z.enum(['llm_low_confidence','llm_failed','skipped']),
  confidence: z.number().nullable(),
})
export type UnfilledField = z.infer<typeof UnfilledFieldSchema>

export const NodeSchema = z.object({
  url:            z.string(),
  normalizedUrl:  z.string(),
  title:          z.string(),
  pageRef:        z.string().optional(),
  fingerprint:    z.string(),
  uiLibrary:      UILibrarySchema,
  elements:       z.array(CapturedElementSchema),
  unfilledFields: z.array(UnfilledFieldSchema).default([]),
  screenshotPath: z.string().optional(),
})
export type Node = z.infer<typeof NodeSchema>

export const EdgeSchema = z.object({
  id:      z.string(),
  from:    z.string(),
  to:      z.string(),
  trigger: z.object({
    type:         z.enum(['link_click','button_click','form_submit','tab_click','new_tab','js_navigation']),
    semanticType: z.enum(['navigate','open_modal','submit_form','trigger_action','reveal_content']).nullable(),
    elementId:    z.string(),
    elementName:  z.string().nullable(),
    formFields:   z.array(z.string()).optional(),
  }),
})
export type Edge = z.infer<typeof EdgeSchema>

export const GraphSchema = z.object({
  meta: z.object({
    crawledAt:      z.string(),
    seedUrl:        z.string(),
    appId:          z.string(),
    flowName:       z.string().optional(),
    uiLibrary:      UILibrarySchema,
    totalNodes:     z.number(),
    totalEdges:     z.number(),
    unfilledFields: z.number(),
    llmCallCount:   z.number(),
    cacheHitCount:  z.number(),
    summary:        z.string().optional(),
    source:         z.literal('flow-crawler'),
  }),
  nodes: z.record(z.string(), NodeSchema),
  edges: z.array(EdgeSchema),
})
export type Graph = z.infer<typeof GraphSchema>

// ── LLM schemas ────────────────────────────────────────────────────────────────
export const FilteredElementsSchema = z.object({
  relevantElementIds: z.array(z.string()),
  reasoning:          z.string(),
})
export type FilteredElements = z.infer<typeof FilteredElementsSchema>

export const FieldReasoningSchema = z.object({
  fields: z.array(z.object({
    elementId:  z.string(),
    key:        z.string(),
    value:      z.string(),
    confidence: z.number().min(0).max(1),
    reasoning:  z.string(),
    format:     z.string().optional(),
  })),
})
export type FieldReasoning = z.infer<typeof FieldReasoningSchema>

export const ParsedNotesSchema = z.object({
  generalRules:    z.array(z.string()),
  skipSelectors:   z.array(z.string()),
  fieldHints:      z.record(z.string(), z.string()),
  loginInstructions: z.string().optional(),
})
export type ParsedNotes = z.infer<typeof ParsedNotesSchema>

// ── Config ─────────────────────────────────────────────────────────────────────
export const LLMProviderSchema = z.enum(['anthropic','openai','gemini','ollama','azure'])
export type LLMProvider = z.infer<typeof LLMProviderSchema>

export const CrawlerConfigSchema = z.object({
  appId:     z.string(),
  seedUrl:   z.string(),
  flowName:  z.string().optional(),
  outputDir: z.string().default('../../shared/outputs'),
  excelFile: z.string().default('./crawl-data.xlsx'),
  cacheFile: z.string().default('./crawl_data.json'),
  headless:  z.boolean().default(true),
  maxDepth:  z.number().default(10),
  maxPages:  z.number().default(60),
  llm: z.object({
    enabled:             z.boolean().default(true),
    smartProvider:       LLMProviderSchema.default('openai'),
    smartModel:          z.string().default('gpt-4o'),
    fastProvider:        LLMProviderSchema.default('openai'),
    fastModel:           z.string().default('gpt-4o-mini'),
    confidenceThreshold: z.number().default(0.7),
    ollamaBaseUrl:       z.string().optional(),
    azureEndpoint:       z.string().optional(),
    azureDeployment:     z.string().optional(),
  }).default({}),
})
export type CrawlerConfig = z.infer<typeof CrawlerConfigSchema>

// ── Job record ─────────────────────────────────────────────────────────────────
export interface JobRecord {
  status:          'STARTED' | 'RUNNING' | 'COMPLETE' | 'FAILED'
  app_id:          string
  seed_url:        string
  started_at:      string
  finished_at?:    string
  node_count?:     number
  edge_count?:     number
  unfilled_fields?: number
  llm_call_count?: number
  cache_hit_count?: number
  output_file?:    string
  error?:          string
  summary?:        string
}
