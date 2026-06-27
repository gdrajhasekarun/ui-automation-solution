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
  flow_name:      z.string().optional(),   // focused flow intent — overrides config.flowName
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

// ── Spec (page intent + element description) ───────────────────────────────────
export const SpecSchema = z.object({
  intent:          z.string().optional(),
  expectedOutcome: z.string().optional(),
  precondition:    z.string().optional(),
  description:     z.string().optional(),
  userEdited:      z.boolean().default(false),
  confidence:      z.number().min(0).max(1).optional(),
  generatedAt:     z.string().optional(),
})
export type Spec = z.infer<typeof SpecSchema>

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
  spec:             SpecSchema.optional(),
  // Internal — not serialised to graph
  _selector:        z.string().optional(),
  _resolvedValue:   z.string().nullable().optional(),
  _selectOptions:   z.array(z.string()).optional(),
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
  description:    z.string().optional(),
  fingerprint:    z.string(),
  uiLibrary:      UILibrarySchema,
  // Runtime-only: full merged set (globalElements + ownElements). Not serialized to disk.
  elements:            z.array(CapturedElementSchema),
  // Serialized: elements unique to this page (not in globalElements)
  ownElements:         z.array(CapturedElementSchema).optional(),
  // Serialized: IDs of globalElements that appear on this specific page
  inheritedElementIds: z.array(z.string()).optional(),
  unfilledFields: z.array(UnfilledFieldSchema).default([]),
  screenshotPath: z.string().optional(),
  spec:           SpecSchema.optional(),
  className:      z.string().optional(),
})
export type Node = z.infer<typeof NodeSchema>

export const ElementDiffSchema = z.object({
  appeared:    z.array(z.string()),  // element IDs newly visible after this interaction
  disappeared: z.array(z.string()),  // element IDs no longer visible after this interaction
})
export type ElementDiff = z.infer<typeof ElementDiffSchema>

export const ValidationResultSchema = z.object({
  passed:    z.array(z.string()),  // element IDs from elementDiff.appeared that were found
  failed:    z.array(z.string()),  // element IDs from elementDiff.appeared that were missing
  timestamp: z.string(),
})
export type ValidationResult = z.infer<typeof ValidationResultSchema>

export const EdgeSchema = z.object({
  id:          z.string(),
  from:        z.string(),
  to:          z.string(),
  isBranching: z.boolean().optional(),   // true when the same trigger can lead to multiple destinations
  condition:   z.string().optional(),    // inferred condition for this branch (e.g. 'authenticated', 'unauthenticated')
  trigger: z.object({
    type:         z.enum(['link_click','button_click','form_submit','tab_click','new_tab','js_navigation']),
    semanticType: z.enum(['navigate','open_modal','submit_form','trigger_action','reveal_content']).nullable(),
    elementId:    z.string(),
    elementName:  z.string().nullable(),
    formFields:   z.array(z.string()).optional(),   // deprecated — kept for read compat only
    prerequisiteActions: z.array(z.object({
      elementId:   z.string(),
      elementName: z.string().nullable(),
      elementType: z.string(),
      action:      z.enum(['fill', 'select']),
      value:       z.string().nullable(),
      source:      z.enum(['excel', 'notes', 'static', 'llm', 'cache', 'skip']),
    })).optional(),
  }),
  // Recorded during crawl: which elements appeared/disappeared after this interaction
  elementDiff:      ElementDiffSchema.optional(),
  // Populated during replay: which appeared elements were found/missing
  validationResult: ValidationResultSchema.optional(),
  // Populated post-crawl by annotateGraph — describes what this transition accomplishes
  spec: z.object({
    intent:      z.string().optional(),
    userEdited:  z.boolean().default(false),
    generatedAt: z.string().optional(),
  }).optional(),
})
export type Edge = z.infer<typeof EdgeSchema>

export const EvalDimensionSchema = z.object({
  score: z.number().min(0).max(100),
  notes: z.string(),
})
export type EvalDimension = z.infer<typeof EvalDimensionSchema>

export const SpecQualitySchema = z.object({
  score:          z.number().min(0).max(100),
  notes:          z.string(),
  recommendation: z.enum(['ready', 'review_required', 'recrawl_recommended']),
})
export type SpecQuality = z.infer<typeof SpecQualitySchema>

export const EvalSchema = z.object({
  score:   z.number().min(0).max(100),
  grade:   z.enum(['A', 'B', 'C', 'D', 'F']),
  dimensions: z.object({
    coverage:            EvalDimensionSchema,
    interactionAccuracy: EvalDimensionSchema,
    graphQuality:        EvalDimensionSchema,
    routePrediction:     EvalDimensionSchema,
  }),
  specQuality:  SpecQualitySchema.nullable(),
  flags:        z.array(z.string()),
  evaluatedAt:  z.string(),
  pathIntent:   z.object({
    score:        z.number().min(0).max(100),
    stepsRecorded: z.number(),
    path:         z.array(z.string()),
  }).optional(),
})
export type Eval = z.infer<typeof EvalSchema>

export const PredictedRouteStepSchema = z.object({
  nodeId:    z.string(),
  elementId: z.string(),
  action:    z.enum(['fill', 'click', 'select', 'skip']),
  valueHint: z.string().optional(),
})
export type PredictedRouteStep = z.infer<typeof PredictedRouteStepSchema>

export const PredictedRouteSchema = z.object({
  routeId:     z.string(),
  description: z.string(),
  confidence:  z.number().min(0).max(1),
  steps:       z.array(PredictedRouteStepSchema),
  expectedNewNode: z.object({
    urlPattern:  z.string().optional(),
    intentHint:  z.string().optional(),
  }).optional(),
})
export type PredictedRoute = z.infer<typeof PredictedRouteSchema>

export const RoutePredictionSchema = z.object({
  routes: z.array(PredictedRouteSchema),
})

export const PageAnnotationSchema = z.object({
  nodeId:          z.string(),
  intent:          z.string(),
  expectedOutcome: z.string().optional(),
  precondition:    z.string().optional(),
  elements: z.array(z.object({
    elementId:       z.string(),
    description:     z.string(),
    expectedOutcome: z.string().optional(),
  })),
})

export const AnnotationBatchSchema = z.object({
  pages: z.array(PageAnnotationSchema),
})

export const GraphSchema = z.object({
  // Elements shared across ≥ threshold pages — defines the generated BasePage class
  globalElements: z.record(z.string(), CapturedElementSchema).optional(),
  meta: z.object({
    crawledAt:             z.string(),
    seedUrl:               z.string(),
    appId:                 z.string(),
    flowName:              z.string().optional(),
    uiLibrary:             UILibrarySchema,
    totalNodes:            z.number(),
    totalEdges:            z.number(),
    unfilledFields:        z.number(),
    cacheHitCount:         z.number(),
    summary:               z.string().optional(),
    source:                z.literal('flow-crawler'),
    totalPredictedRoutes:  z.number().optional(),
    confirmedPredictions:  z.number().optional(),
    crawlErrors:           z.number().optional(),
    annotatedAt:           z.string().optional(),
    aliases:               z.record(z.string()).optional(),
    diff: z.object({
      newNodes:     z.array(z.string()),
      removedNodes: z.array(z.string()),
      changedNodes: z.array(z.string()),
      newEdges:     z.array(z.string()),
      removedEdges: z.array(z.string()),
      unchanged:    z.number(),
    }).optional(),
    eval:  EvalSchema.optional(),
    llmUsage: z.object({
      totalCalls:   z.number(),
      totalTokens:  z.number(),
      totalCostUsd: z.number(),
      calls: z.array(z.object({
        fn:           z.string(),
        model:        z.string(),
        inputTokens:  z.number(),
        outputTokens: z.number(),
        costUsd:      z.number(),
        ts:           z.number(),
      })),
    }).optional(),
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
  annotate:               z.boolean().default(true),
  routePredictionEnabled: z.boolean().default(true),
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
  status:                    'STARTED' | 'RUNNING' | 'COMPLETE' | 'FAILED'
  app_id:                    string
  seed_url:                  string
  started_at:                string
  finished_at?:              string
  node_count?:               number
  edge_count?:               number
  unfilled_fields?:          number
  cache_hit_count?:          number
  output_file?:              string
  error?:                    string
  summary?:                  string
  eval_score?:               number
  eval_grade?:               string
  spec_quality_recommendation?: string
}
