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
import { nameElements } from './nameElements.js'
import { nameNodes } from './nameNodes.js'

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
    for (const [nodeId, node] of Object.entries(previousGraph.nodes)) {
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
      } as Partial<import('../types.js').Node>)
      continue
    }
    toAnnotate.push({ nodeId, fingerprint: node.fingerprint ?? '' })
  }

  if (toAnnotate.length === 0) {
    log.info('ANNOTATE', 'All nodes reused from previous graph — no LLM calls needed')
    await nameNodes(graph, fastLLM)
    await nameElements(graph, fastLLM)
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
- precondition: ALWAYS write a precondition — never omit it.
  For public entry points that require no prior action write exactly:
  "None — public entry point."
  For all other pages describe what must have happened on the previous page
  (e.g. "User must have logged in on the Login page" or
  "User must have selected a facility on the Facility Selection page").
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

  // Map elementId → destination page name for buttons/links that triggered navigation
  const elemDestination = new Map<string, string>()
  // Map nodeId → human-readable arrival steps (fill values + click) from inbound edges
  const arrivalSteps = new Map<string, string[]>()
  for (const edge of graphSnapshot.edges) {
    if (edge.trigger?.elementId) {
      const destNode = graphNodes[edge.to]
      const destName = destNode?.pageRef ?? destNode?.title ?? edge.to
      const existing = elemDestination.get(edge.trigger.elementId)
      elemDestination.set(
        edge.trigger.elementId,
        existing ? `${existing} or "${destName}"` : `"${destName}"`,
      )
    }
    // Build arrival context from prerequisiteActions on this edge
    const prereqs = edge.trigger?.prerequisiteActions
    if (prereqs?.length || edge.trigger?.elementId) {
      const steps: string[] = []
      if (prereqs?.length) {
        for (const p of prereqs) {
          steps.push(`fill "${p.elementName ?? p.elementId}" = "${p.value ?? '?'}" (source: ${p.source})`)
        }
      }
      if (edge.trigger?.elementName) {
        steps.push(`click "${edge.trigger.elementName}"`)
      }
      if (steps.length) {
        if (!arrivalSteps.has(edge.to)) arrivalSteps.set(edge.to, [])
        arrivalSteps.get(edge.to)!.push(steps.join(' → '))
      }
    }
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

  const MAX_OPTS = 15
  const NAVIGABLE_TYPES = new Set(['button', 'submit', 'link'])

  function buildPageInput(nodeId: string): string {
    const node = graphNodes[nodeId]
    const sorted = [
      ...node.elements.filter(e => FORM_TYPES.has(e.elementType)),
      ...node.elements.filter(e => !FORM_TYPES.has(e.elementType)),
    ]
    const elemLines = sorted.slice(0, MAX_ELEMENTS_PER_NODE).map(e => {
      const placeholder  = e.placeholder ? ` placeholder="${e.placeholder}"` : ''
      const inputTypeStr = e.inputType    ? ` inputType=${e.inputType}`       : ''
      const requiredStr  = e.required     ? ` required=true`                  : ''

      let optStr = ''
      if (e._selectOptions?.length) {
        const opts = e._selectOptions
        if (opts.length <= MAX_OPTS) {
          optStr = ` options=[${opts.join('|')}]`
        } else {
          optStr = ` options=[${opts.slice(0, MAX_OPTS).join('|')}] (+${opts.length - MAX_OPTS} more)`
        }
      }

      let destStr = ''
      if (NAVIGABLE_TYPES.has(e.elementType)) {
        const dest = elemDestination.get(e.id)
        if (dest) destStr = ` → navigates to ${dest}`
      }

      return `  id=${e.id} name="${e.name}" type=${e.elementType} label="${e.label ?? ''}"${placeholder}${optStr}${inputTypeStr}${requiredStr}${destStr}`
    }).join('\n')

    const existingIntent = node.spec?.intent ? `\nexisting intent (enrich, do not discard): "${node.spec.intent}"` : ''
    const descriptionLine = (node.description && node.description !== node.title)
      ? `\ndescription: ${node.description.slice(0, 300)}`
      : ''
    const arrivals = arrivalSteps.get(nodeId)
    const arrivalLine = arrivals?.length
      ? `\narrived via: ${arrivals.join(' OR ')}`
      : ''

    return `nodeId: ${nodeId}\nurl: ${node.url}\ntitle: ${node.title}${descriptionLine}\npageRef: ${node.pageRef ?? ''}${arrivalLine}${existingIntent}\nelements:\n${elemLines}`
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

  await annotateEdges(graph, fastLLM, graphSnapshot)

  // Assign className to every node using spec.intent (cached by nodeId)
  await nameNodes(graph, fastLLM)

  // Assign uniqueName to every element (deterministic + LLM for collisions only)
  await nameElements(graph, fastLLM)

  graph.setAnnotatedAt(new Date().toISOString())
}

async function annotateEdges(
  graph: CrawlerGraph,
  fastLLM: BaseChatModel,
  graphSnapshot: ReturnType<CrawlerGraph['toJSON']>,
): Promise<void> {
  const graphNodes = graphSnapshot.nodes
  const EDGE_BATCH_SIZE = 8

  // Collect edges that need annotation
  const toAnnotate = graphSnapshot.edges.filter(e => !e.spec?.intent || !e.spec.userEdited)
  if (toAnnotate.length === 0) {
    log.info('ANNOTATE', 'All edges already have spec.intent — skipping edge annotation')
    return
  }
  log.info('ANNOTATE', `Annotating ${toAnnotate.length} edges (${Math.ceil(toAnnotate.length / EDGE_BATCH_SIZE)} batches)`)

  const EdgeAnnotationSchema = {
    type: 'object',
    properties: {
      edges: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            edgeId: { type: 'string' },
            intent: { type: 'string' },
          },
          required: ['edgeId', 'intent'],
        },
      },
    },
    required: ['edges'],
  }

  const edgePrompt = ChatPromptTemplate.fromMessages([
    ['system', `You are annotating navigation edges in a web app graph for a TEST PLANNER.
Each edge represents a user action (filling fields + clicking a button/link) that transitions between pages.
Write a single sentence for each edge describing: what the user does and why (what they are trying to accomplish).
Be specific — name the fields filled and the destination page.
Example: "Fills the HCPCS code field with a procedure code and clicks Search Fees to retrieve the physician fee schedule results."
Return ONLY valid JSON: {{ "edges": [{{ "edgeId": "...", "intent": "..." }}] }}`],
    ['human', `{edges}`],
  ])

  const structured = (fastLLM as any).withStructuredOutput(EdgeAnnotationSchema)
  const edgeChain = edgePrompt.pipe(structured)

  function buildEdgeInput(edge: (typeof graphSnapshot.edges)[0]): string {
    const fromNode = graphNodes[edge.from]
    const toNode   = graphNodes[edge.to]
    const fromRef  = fromNode?.pageRef ?? fromNode?.title ?? edge.from
    const toRef    = toNode?.pageRef   ?? toNode?.title   ?? edge.to
    const fromIntent = fromNode?.spec?.intent ? `from page: "${fromRef}" (${fromNode.spec.intent})` : `from page: "${fromRef}"`
    const toIntent   = toNode?.spec?.intent   ? `to page: "${toRef}" (${toNode.spec.intent})`       : `to page: "${toRef}"`
    const prereqs = (edge.trigger.prerequisiteActions ?? [])
      .map(p => `fill "${p.elementName ?? p.elementId}" (${p.elementType})`)
      .join(', ')
    const click = `click "${edge.trigger.elementName ?? edge.trigger.elementId}" (${edge.trigger.semanticType ?? edge.trigger.type})`
    return `edgeId: ${edge.id}\n${fromIntent}\n${toIntent}\nactions: ${prereqs ? prereqs + ', then ' : ''}${click}`
  }

  for (let i = 0; i < toAnnotate.length; i += EDGE_BATCH_SIZE) {
    const batch = toAnnotate.slice(i, i + EDGE_BATCH_SIZE)
    const input = batch.map(buildEdgeInput).join('\n\n---\n\n')
    const now   = new Date().toISOString()
    try {
      const result = await edgeChain.invoke({ edges: input }) as { edges: Array<{ edgeId: string; intent: string }> }
      for (const { edgeId, intent } of result.edges) {
        graph.updateEdge(edgeId, { spec: { intent, userEdited: false, generatedAt: now } })
      }
    } catch (err: any) {
      log.warn('ANNOTATE', `Edge batch ${Math.floor(i / EDGE_BATCH_SIZE) + 1} failed: ${err.message?.slice(0, 120)}`)
    }
  }
}
