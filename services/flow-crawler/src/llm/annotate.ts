/**
 * annotate.ts
 * Post-crawl LLM pass that writes page intent and element descriptions
 * onto every node and element in the graph. Runs once after crawl
 * completes. Uses fast model — descriptions are short.
 * Human-edited specs (userEdited: true) are never overwritten.
 * Unchanged nodes (same fingerprint as previous graph) reuse prior specs.
 */
import * as fs from 'fs'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { ChatPromptTemplate } from '@langchain/core/prompts'
import type { CrawlerGraph } from '../graph/index.js'
import type { Graph, CrawlerConfig } from '../types.js'
import { AnnotationBatchSchema } from '../types.js'
import { log } from '../logger.js'

const BATCH_SIZE = 2
const MAX_ELEMENTS_PER_NODE = 12

export async function annotateGraph(
  graph: CrawlerGraph,
  fastLLM: BaseChatModel | null,
  previousGraph: Graph | null,
  _config: CrawlerConfig,
): Promise<void> {
  if (!fastLLM) return

  // Build fingerprint → spec map from previous graph for reuse
  const prevSpecByFingerprint = new Map<string, { intent?: string; expectedOutcome?: string; precondition?: string }>()
  const prevElemSpecBySelector = new Map<string, { description: string; expectedOutcome?: string }>()
  if (previousGraph) {
    for (const node of Object.values(previousGraph.nodes)) {
      if (node.fingerprint && node.spec?.intent) {
        prevSpecByFingerprint.set(node.fingerprint, {
          intent:          node.spec.intent,
          expectedOutcome: node.spec.expectedOutcome,
          precondition:    node.spec.precondition,
        })
      }
      for (const el of node.elements ?? []) {
        if (el._selector && el.spec?.description) {
          prevElemSpecBySelector.set(el._selector, {
            description:     el.spec.description,
            expectedOutcome: el.spec.expectedOutcome,
          })
        }
      }
    }
  }

  // Collect nodes that need annotation
  const nodeEntries = graph.toJSON().nodes
  const toAnnotate: Array<{ nodeId: string; fingerprint: string }> = []

  for (const [nodeId, node] of Object.entries(nodeEntries)) {
    if (node.spec?.userEdited) continue
    // Reuse from previous graph if fingerprint unchanged AND specs are substantive.
    // A node is considered well-annotated only if:
    //   1. Page intent is > 60 chars (not a one-liner like "Displays the homepage.")
    //   2. No form element has a spec shorter than 50 chars or missing when _selectOptions exist
    const prevSpec = prevSpecByFingerprint.get(node.fingerprint)
    const FORM_TYPES_REUSE = new Set(['textbox', 'textarea', 'select', 'combobox', 'checkbox', 'radio', 'button', 'submit'])
    const hasWeakElemSpec = node.elements.some(el => {
      if (!FORM_TYPES_REUSE.has(el.elementType)) return false
      const prevEntry = el._selector ? prevElemSpecBySelector.get(el._selector) : undefined
      const prevDesc = prevEntry?.description
      if (!prevDesc || prevDesc.length < 50) return true
      // select element has options but spec doesn't mention any of them
      if (el._selectOptions?.length && !el._selectOptions.some(o => prevDesc.includes(o.slice(0, 8)))) return true
      return false
    })
    const specIsSubstantive = prevSpec?.intent && prevSpec.intent.length > 60 && !hasWeakElemSpec
    if (prevSpec && specIsSubstantive) {
      const prev = prevSpec
      const now = new Date().toISOString()
      const updatedElements = node.elements.map(el => {
        if (el.spec?.userEdited) return el
        const prevEntry = el._selector ? prevElemSpecBySelector.get(el._selector) : undefined
        return {
          ...el,
          spec: {
            description:     prevEntry?.description     ?? el.spec?.description,
            expectedOutcome: prevEntry?.expectedOutcome ?? el.spec?.expectedOutcome,
            userEdited:      false,
            generatedAt:     now,
          },
        }
      })
      graph.updateNode(nodeId, {
        spec: {
          intent:          prev.intent,
          expectedOutcome: prev.expectedOutcome,
          precondition:    prev.precondition,
          userEdited:      false,
          generatedAt:     now,
        },
        elements: updatedElements,
      })
      continue
    }
    toAnnotate.push({ nodeId, fingerprint: node.fingerprint ?? '' })
  }

  if (toAnnotate.length === 0) {
    log.info('ANNOTATE', 'All nodes reused from previous graph — no LLM calls needed')
    graph.setAnnotatedAt(new Date().toISOString())
    return
  }

  log.info('ANNOTATE', `Annotating ${toAnnotate.length} nodes (${Math.ceil(toAnnotate.length / BATCH_SIZE)} batches)`)

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', `You are annotating a web application graph so a TEST PLANNER can convert
high-level test cases (e.g. "create an appointment for Friday") into exact
click-level interaction steps.

Your annotations are the ONLY context the planner has about each page and element.
Write them so the planner can answer without seeing the UI:
  "Which page do I go to? What must be true before I arrive? What do I do here?
   What value do I enter? What happens after I interact?"

OUTPUT FIELDS PER PAGE:
- intent: one sentence — the user goal this page fulfills. MUST name (a) what the user
  does here and (b) what page comes before/after from the navigation context.
  If an existing intent is provided, ENRICH it rather than discarding it.
  Example: "Appointment booking form where the user selects a facility, date and
  healthcare program after logging in; submitting navigates to the confirmation page."
- precondition: what must be true before the user reaches this page (e.g. "user must
  be logged in", "user must have selected a facility on the previous page"). Omit if
  the page is a public entry point.
- expectedOutcome: what the test agent should observe after completing all actions on
  this page (e.g. "confirmation page appears showing appointment ID and facility name").

OUTPUT FIELDS PER ELEMENT:
- description: what the element does in terms of the test goal. Be SPECIFIC:
  - select/combobox: ALWAYS list the options from the element data
  - textbox: include an example value (e.g. "Enter patient name, e.g. 'John Doe'")
  - checkbox/radio: state what selecting it means in business terms
  - button/link: state what action it triggers
  NOT: "A dropdown element", "Selects a value", "Allows user to select"
- expectedOutcome: what changes after interacting with this element (e.g. "date picker
  opens", "form submits and confirmation page loads", "additional fields become visible").
  Only include when the interaction causes a visible state change or navigation.

IMPORTANT SCOPING RULES:
- Pages often contain widgets unrelated to the crawled flow (e.g. newsletter signup, social
  links, cookie banners). Base intent, precondition, and expectedOutcome ONLY on the
  navigation graph context and the target flow — do NOT derive preconditions from incidental
  page elements that were not part of the crawl path.
- Only annotate elements listed in the page data below. Skip incidental widgets
  (newsletter signups, social share buttons, footer nav links) — set their description to
  a brief dismissal or omit their elementId from the output entirely.`],
    ['human', `App summary: {appSummary}
Target flow being crawled: {flowName}

Crawl notes (credentials, field hints, known values):
{crawlNotes}

Navigation context (which pages link to/from each page):
{navContext}

Annotate these page states:\n\n{pages}

CRITICAL — return JSON matching EXACTLY this structure (elements nested inside each page, NOT as siblings):
{{
  "pages": [
    {{
      "nodeId": "<nodeId from above>",
      "intent": "<one sentence>",
      "precondition": "<optional>",
      "expectedOutcome": "<optional>",
      "elements": [
        {{ "elementId": "<id>", "description": "<specific description>", "expectedOutcome": "<optional>" }}
      ]
    }}
  ]
}}`],
  ])

  const structured = (fastLLM as any).withStructuredOutput(AnnotationBatchSchema)
  const chain = prompt.pipe(structured)
  const graphSnapshot = graph.toJSON()
  const graphNodes = graphSnapshot.nodes

  // Build navigation context: for each node, which page names link to it and from it
  const inboundNames  = new Map<string, string[]>()
  const outboundNames = new Map<string, string[]>()
  for (const edge of graphSnapshot.edges) {
    const fromName = graphNodes[edge.from]?.pageRef ?? graphNodes[edge.from]?.title ?? edge.from
    const toName   = graphNodes[edge.to]?.pageRef   ?? graphNodes[edge.to]?.title   ?? edge.to
    if (!outboundNames.has(edge.from)) outboundNames.set(edge.from, [])
    if (!inboundNames.has(edge.to))   inboundNames.set(edge.to, [])
    outboundNames.get(edge.from)!.push(toName)
    inboundNames.get(edge.to)!.push(fromName)
  }

  const appSummary = graphSnapshot.meta.summary ?? `A web application with ${Object.keys(graphNodes).length} pages`

  // Include crawl-notes so the LLM knows credentials, valid field values, and flow hints.
  // The notes are copied alongside graph.json by orchestration/index.ts after each run.
  let crawlNotes = ''
  try {
    const outputDir = graph.toJSON().meta?.appId
      ? `../../shared/outputs/${graph.toJSON().meta.appId}`
      : '.'
    const candidates = [`${outputDir}/crawl-notes.md`, './crawl-notes.md']
    for (const p of candidates) {
      if (fs.existsSync(p)) { crawlNotes = fs.readFileSync(p, 'utf8').slice(0, 2000); break }
    }
  } catch { /* optional */ }

  const FORM_TYPES = new Set(['textbox', 'textarea', 'select', 'combobox', 'checkbox', 'radio', 'button', 'submit'])
  const flowName = _config.flowName ?? 'general web app exploration'

  function buildPageInput(nodeId: string): string {
    const node = graphNodes[nodeId]
    const sorted = [
      ...node.elements.filter(e => FORM_TYPES.has(e.elementType)),
      ...node.elements.filter(e => !FORM_TYPES.has(e.elementType)),
    ]
    const elemLines = sorted.slice(0, MAX_ELEMENTS_PER_NODE).map(e => {
      const placeholder = e.placeholder ? ` placeholder="${e.placeholder}"` : ''
      const options = e._selectOptions?.length ? ` options=[${e._selectOptions.slice(0, 5).join('|')}]` : ''
      return `  id=${e.id} name="${e.name}" type=${e.elementType} label="${e.label ?? ''}"${placeholder}${options}`
    }).join('\n')
    const existingIntent = node.spec?.intent ? `\nexisting intent (enrich, do not discard): "${node.spec.intent}"` : ''
    return `nodeId: ${nodeId}\nurl: ${node.url}\ntitle: ${node.title}\npageRef: ${node.pageRef ?? ''}${existingIntent}\nelements:\n${elemLines}`
  }

  function buildNavContext(nodeIds: string[]): string {
    return nodeIds.map(nodeId => {
      const from = inboundNames.get(nodeId) ?? []
      const to   = outboundNames.get(nodeId) ?? []
      return `${nodeId}: reached from [${from.join(', ') || 'entry point'}] → leads to [${to.join(', ') || 'terminal'}]`
    }).join('\n')
  }

  function applyAnnotationResult(pages: Array<{
    nodeId: string; intent: string; expectedOutcome?: string; precondition?: string
    elements: Array<{ elementId: string; description: string; expectedOutcome?: string }>
  }>): void {
    const now = new Date().toISOString()
    for (const page of pages) {
      const node = graphNodes[page.nodeId]
      if (!node) continue
      const elemSpecById = new Map(page.elements.map(e => [e.elementId, e]))
      const updatedElements = node.elements.map(el => {
        if (el.spec?.userEdited) return el
        const eSpec = elemSpecById.get(el.id)
        return {
          ...el,
          spec: {
            description:     eSpec?.description     ?? el.spec?.description,
            expectedOutcome: eSpec?.expectedOutcome ?? el.spec?.expectedOutcome,
            userEdited:      false,
            generatedAt:     now,
          },
        }
      })
      graph.updateNode(page.nodeId, {
        spec: {
          intent:          page.intent,
          expectedOutcome: page.expectedOutcome,
          precondition:    page.precondition,
          userEdited:      false,
          generatedAt:     now,
        },
        elements: updatedElements,
      })
    }
  }

  async function invokeBatch(nodeIds: string[]): Promise<void> {
    const pagesInput = nodeIds.map(buildPageInput).join('\n\n---\n\n')
    const navContext = buildNavContext(nodeIds)
    const result = await chain.invoke({ pages: pagesInput, navContext, appSummary, crawlNotes: crawlNotes || 'none', flowName }) as {
      pages: Array<{
        nodeId: string; intent: string; expectedOutcome?: string; precondition?: string
        elements: Array<{ elementId: string; description: string; expectedOutcome?: string }>
      }>
    }
    applyAnnotationResult(result.pages)
  }

  for (let i = 0; i < toAnnotate.length; i += BATCH_SIZE) {
    const batch = toAnnotate.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1
    try {
      await invokeBatch(batch.map(b => b.nodeId))
    } catch (batchErr: any) {
      log.warn('ANNOTATE', `Batch ${batchNum} failed (${batch.length} nodes) — retrying one node at a time`)
      for (const { nodeId } of batch) {
        try {
          await invokeBatch([nodeId])
        } catch (singleErr: any) {
          log.warn('ANNOTATE', `  Node ${nodeId} failed after retry: ${singleErr.message?.slice(0, 120)}`)
        }
      }
    }
  }

  graph.setAnnotatedAt(new Date().toISOString())
}
