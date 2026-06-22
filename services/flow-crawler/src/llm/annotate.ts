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

const BATCH_SIZE = 5

export async function annotateGraph(
  graph: CrawlerGraph,
  fastLLM: BaseChatModel | null,
  previousGraph: Graph | null,
  _config: CrawlerConfig,
): Promise<void> {
  if (!fastLLM) return

  // Build fingerprint → spec map from previous graph for reuse
  const prevSpecByFingerprint = new Map<string, { intent?: string; description?: string }>()
  const prevElemSpecBySelector = new Map<string, string>()
  if (previousGraph) {
    for (const node of Object.values(previousGraph.nodes)) {
      if (node.fingerprint && node.spec?.intent) {
        prevSpecByFingerprint.set(node.fingerprint, { intent: node.spec.intent })
      }
      for (const el of node.elements ?? []) {
        if (el._selector && el.spec?.description) {
          prevElemSpecBySelector.set(el._selector, el.spec.description)
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
      const prevDesc = el._selector ? prevElemSpecBySelector.get(el._selector) : undefined
      if (!prevDesc || prevDesc.length < 50) return true
      // select element has options but spec doesn't mention any of them
      if (el._selectOptions?.length && !el._selectOptions.some(o => prevDesc.includes(o.slice(0, 8)))) return true
      return false
    })
    const specIsSubstantive = prevSpec?.intent && prevSpec.intent.length > 60 && !hasWeakElemSpec
    if (prevSpec && specIsSubstantive) {
      const prev = prevSpec
      const now = new Date().toISOString()
      const updatedElements = node.elements.map(el => ({
        ...el,
        spec: el.spec?.userEdited ? el.spec : {
          description: el._selector ? (prevElemSpecBySelector.get(el._selector) ?? el.spec?.description) : el.spec?.description,
          userEdited:  false,
          generatedAt: now,
        },
      }))
      graph.updateNode(nodeId, {
        spec: { intent: prev.intent, userEdited: false, generatedAt: now },
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
Write them so the planner can answer: "which page do I go to, which element do I
interact with, and what value do I enter?"

Rules:
- Page intent: one sentence describing the USER GOAL this page fulfills. MUST include:
  (a) what the user does on this page, and
  (b) what page comes before and after in the flow (from the navigation context).
  If an existing intent is provided, ENRICH it — add missing nav context or missing
  details — do not discard what is already correct.
  Example: "Appointment booking form where the user selects a facility, date and
  healthcare program after logging in; submitting navigates to the confirmation page."
- Element description: what the element does in terms of the test goal, including any
  known valid values or constraints. Be SPECIFIC:
  - For select/combobox: ALWAYS list the options provided in the element data
  - For textbox: include example value from crawl notes or placeholder (e.g. "Enter username, e.g. 'John Doe'")
  - For checkbox/radio: state what checking it means in business terms
  - For button: state what action it triggers and what comes next
  Example: "Dropdown to select the healthcare facility; valid options: 'Hongkong CURA
  Healthcare Center', 'Seoul CURA Healthcare Center', 'Tokyo CURA Healthcare Center'."
  NOT: "A dropdown element", "Selects a value", or "Allows user to select".`],
    ['human', `App summary: {appSummary}

Crawl notes (credentials, field hints, known values):
{crawlNotes}

Navigation context (which pages link to/from each page):
{navContext}

Annotate these page states:\n\n{pages}\n\nReturn JSON with pages array.`],
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

  for (let i = 0; i < toAnnotate.length; i += BATCH_SIZE) {
    const batch = toAnnotate.slice(i, i + BATCH_SIZE)

    const navContext = batch.map(({ nodeId }) => {
      const from = inboundNames.get(nodeId) ?? []
      const to   = outboundNames.get(nodeId) ?? []
      return `${nodeId}: reached from [${from.join(', ') || 'entry point'}] → leads to [${to.join(', ') || 'terminal'}]`
    }).join('\n')

    const pagesInput = batch.map(({ nodeId }) => {
      const node = graphNodes[nodeId]
      const FORM_TYPES = new Set(['textbox', 'textarea', 'select', 'combobox', 'checkbox', 'radio', 'button', 'submit'])
      // Form/action elements first so the LLM focuses on what matters for test planning
      const sorted = [
        ...node.elements.filter(e => FORM_TYPES.has(e.elementType)),
        ...node.elements.filter(e => !FORM_TYPES.has(e.elementType)),
      ]
      const elemLines = sorted.slice(0, 20).map(e => {
        const placeholder = e.placeholder ? ` placeholder="${e.placeholder}"` : ''
        const options = e._selectOptions?.length ? ` options=[${e._selectOptions.slice(0, 5).join('|')}]` : ''
        return `  id=${e.id} name="${e.name}" type=${e.elementType} label="${e.label ?? ''}"${placeholder}${options}`
      }).join('\n')
      const existingIntent = node.spec?.intent ? `\nexisting intent (enrich, do not discard): "${node.spec.intent}"` : ''
      return `nodeId: ${nodeId}\nurl: ${node.url}\ntitle: ${node.title}\npageRef: ${node.pageRef ?? ''}${existingIntent}\nelements:\n${elemLines}`
    }).join('\n\n---\n\n')

    try {
      const result = await chain.invoke({ pages: pagesInput, navContext, appSummary, crawlNotes: crawlNotes || 'none' }) as { pages: Array<{ nodeId: string; intent: string; elements: Array<{ elementId: string; description: string }> }> }
      const now = new Date().toISOString()

      for (const page of result.pages) {
        const node = graphNodes[page.nodeId]
        if (!node) continue
        const descById = new Map(page.elements.map(e => [e.elementId, e.description]))
        const updatedElements = node.elements.map(el => ({
          ...el,
          spec: el.spec?.userEdited ? el.spec : {
            description: descById.get(el.id) ?? el.spec?.description,
            userEdited:  false,
            generatedAt: now,
          },
        }))
        graph.updateNode(page.nodeId, {
          spec: { intent: page.intent, userEdited: false, generatedAt: now },
          elements: updatedElements,
        })
      }
    } catch (err: any) {
      log.warn('ANNOTATE', `Batch ${Math.floor(i / BATCH_SIZE) + 1} failed: ${err.message}`)
    }
  }

  graph.setAnnotatedAt(new Date().toISOString())
}
