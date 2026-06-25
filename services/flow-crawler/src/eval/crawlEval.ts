/**
 * crawlEval.ts
 * Post-crawl evaluation — scores the completed graph across four dimensions:
 * coverage, interaction accuracy, graph quality, and route prediction accuracy.
 * Runs after annotation, before final graph write.
 * All four numeric scores are deterministic — no LLM needed.
 * One smart LLM call assesses spec quality separately.
 */
import { z } from 'zod'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { ChatPromptTemplate } from '@langchain/core/prompts'
import type { Graph, Eval, SpecQuality } from '../types.js'
import { SpecQualitySchema } from '../types.js'
import { log } from '../logger.js'

const TERMINAL_PATTERNS = /confirm|success|complete|done|thank|summary|receipt|review|finish/i

const TerminalClassificationSchema = z.object({
  terminalNodeIds: z.array(z.string()),
})

async function classifyTerminalNodes(
  candidateIds: string[],
  nodes: Graph['nodes'],
  flowName: string | undefined,
  smartLLM: BaseChatModel,
): Promise<Set<string>> {
  try {
    const pageList = candidateIds.map(id => {
      const n = nodes[id]
      return `nodeId: ${id}\nurl: ${n.url}\ntitle: ${n.title ?? ''}\nintent: ${n.spec?.intent ?? n.description ?? '(none)'}`
    }).join('\n\n')

    const prompt = ChatPromptTemplate.fromMessages([
      ['system', `You are evaluating web crawl results. Given a user's flow goal and a list of leaf pages (pages with no outgoing navigation), decide which ones represent SUCCESSFUL FLOW COMPLETION (e.g. confirmation, receipt, summary, appointment booked) versus genuine DEAD ENDS where the crawl got stuck on an unrelated or broken page.

Return ONLY the nodeIds of pages that are legitimate flow-completion pages. If unsure, err toward marking it as terminal (do not over-flag dead ends).`],
      ['human', `Flow goal: "${flowName ?? 'general web app navigation'}"\n\nLeaf pages:\n\n${pageList}`],
    ])

    const structured = (smartLLM as any).withStructuredOutput(TerminalClassificationSchema)
    const result = await prompt.pipe(structured).invoke({}) as { terminalNodeIds: string[] }
    return new Set<string>(result.terminalNodeIds)
  } catch {
    return new Set<string>()
  }
}

function grade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (score >= 90) return 'A'
  if (score >= 80) return 'B'
  if (score >= 70) return 'C'
  if (score >= 60) return 'D'
  return 'F'
}

export async function runEval(
  graph: Graph,
  smartLLM: BaseChatModel | null,
  previousGraph: Graph | null,
  flowName?: string,
): Promise<Eval> {
  const flags: string[] = []
  const evaluatedAt = new Date().toISOString()

  try {
    const nodes = graph.nodes
    const edges = graph.edges
    const nodeIds = Object.keys(nodes)

    if (nodeIds.length === 0) {
      return {
        score: 0,
        grade: 'F',
        dimensions: {
          coverage:            { score: 0, notes: 'No nodes found' },
          interactionAccuracy: { score: 0, notes: 'No nodes found' },
          graphQuality:        { score: 0, notes: 'No nodes found' },
          routePrediction:     { score: 100, notes: 'No predictions made' },
        },
        specQuality:  null,
        flags:        ['ERROR: empty graph — crawl may have failed entirely'],
        evaluatedAt,
      }
    }

    // ── Inbound edge map ───────────────────────────────────────────────────────
    const inbound = new Map<string, number>()
    const outbound = new Map<string, number>()
    for (const id of nodeIds) { inbound.set(id, 0); outbound.set(id, 0) }
    for (const edge of edges) {
      outbound.set(edge.from, (outbound.get(edge.from) ?? 0) + 1)
      inbound.set(edge.to, (inbound.get(edge.to) ?? 0) + 1)
    }

    const seedNodeId = nodeIds[0]

    // ── Coverage score ─────────────────────────────────────────────────────────
    const expectedNodes = previousGraph?.meta.totalNodes ?? 1
    const orphans = nodeIds.filter(id => id !== seedNodeId && (inbound.get(id) ?? 0) === 0)

    const leafIds = nodeIds.filter(id => (outbound.get(id) ?? 0) === 0)
    const urlTerminals = new Set(leafIds.filter(id => TERMINAL_PATTERNS.test(nodes[id].url)))
    const ambiguous = leafIds.filter(id => !urlTerminals.has(id))
    const llmTerminals = smartLLM && ambiguous.length > 0
      ? await classifyTerminalNodes(ambiguous, nodes, flowName, smartLLM)
      : new Set<string>()
    const deadEnds = ambiguous.filter(id => !llmTerminals.has(id))

    const crawlErrors = graph.meta.crawlErrors ?? 0

    orphans.forEach(id => flags.push(`WARN:  orphan node at ${nodes[id].normalizedUrl} — no inbound edges`))
    deadEnds.forEach(id => flags.push(`WARN:  dead-end node at ${nodes[id].normalizedUrl} — no outbound edges`))

    const coverageBase = Math.min(100, (nodeIds.length / expectedNodes) * 100)
    const coverageScore = Math.max(0, Math.round(
      coverageBase - (orphans.length * 5) - (deadEnds.length * 3) - (crawlErrors * 2)
    ))
    const coverageNotes = [
      `${nodeIds.length} nodes vs ${expectedNodes} expected`,
      orphans.length > 0 && `${orphans.length} orphan(s)`,
      deadEnds.length > 0 && `${deadEnds.length} dead-end(s)`,
      crawlErrors > 0 && `${crawlErrors} crawl error(s)`,
    ].filter(Boolean).join(', ')

    // ── Interaction accuracy score ─────────────────────────────────────────────
    const allElements = nodeIds.flatMap(id => nodes[id].elements ?? [])
    const totalInteracted = allElements.filter(e => e.fillSource !== null)
    const skipped = allElements.filter(e => e.fillSource === 'skip')
    const totalUnfilled = nodeIds.reduce((sum, id) => sum + (nodes[id].unfilledFields?.length ?? 0), 0)

    if (totalUnfilled > 0) {
      flags.push(`WARN:  ${totalUnfilled} fields unfilled across ${nodeIds.length} pages — manual review needed`)
    }

    const interactionBase = totalInteracted.length > 0
      ? (totalInteracted.length - skipped.length) / totalInteracted.length * 100
      : 100
    const interactionScore = Math.max(0, Math.round(
      interactionBase - (totalUnfilled * 3)
    ))
    const interactionNotes = [
      `${totalInteracted.length} elements interacted`,
      skipped.length > 0 && `${skipped.length} skipped (no value resolved)`,
      totalUnfilled > 0 && `${totalUnfilled} unfilled fields`,
    ].filter(Boolean).join(', ')

    // ── Graph quality score ────────────────────────────────────────────────────
    const brokenEdges = edges.filter(e => !nodes[e.to])
    const noSemantic = edges.filter(e => e.trigger.semanticType === null)
    const noDescription = nodeIds.filter(id => !nodes[id].description && !nodes[id].spec?.intent)
    // Only penalise form-fill types and filled/interacted buttons for missing specs.
    // Pure nav buttons (no fillSource, not interacted) are site chrome — they won't be
    // annotated and should not tank the score.
    const FORM_FILL_TYPES = new Set(['textbox', 'textarea', 'select', 'combobox', 'checkbox', 'radio', 'toggle'])
    // Count how many nodes each element label appears on — global nav elements appear on every page
    const labelNodeCount = new Map<string, number>()
    for (const el of allElements) {
      labelNodeCount.set(el.name, (labelNodeCount.get(el.name) ?? 0) + 1)
    }
    const isGlobalChrome = (el: (typeof allElements)[0]) =>
      (labelNodeCount.get(el.name) ?? 0) > 1 && el.elementType === 'button' && !el.fillSource
    const flowElements = allElements.filter(e =>
      FORM_FILL_TYPES.has(e.elementType) ||
      (e.elementType === 'button' && (e.fillSource !== null || e.required)) ||
      e.elementType === 'button'
    ).filter(e => !isGlobalChrome(e))
    const noElemSpec = flowElements.filter(e => !e.spec?.description)

    brokenEdges.forEach(e => flags.push(`ERROR: broken edge ${e.id} — target node ${e.to} missing from graph`))

    const graphScore = Math.max(0, Math.round(
      100
      - (noDescription.length * 5)
      - (noElemSpec.length * 4)
      - (noSemantic.length * 3)
      - (brokenEdges.length * 5)
    ))
    const graphNotes = [
      noDescription.length > 0 && `${noDescription.length} nodes without intent`,
      noSemantic.length > 0 && `${noSemantic.length} edges without semanticType`,
      brokenEdges.length > 0 && `${brokenEdges.length} broken edge(s)`,
      noElemSpec.length > 0 && `${noElemSpec.length} action elements without spec`,
    ].filter(Boolean).join(', ') || 'all good'

    // ── Route prediction score ─────────────────────────────────────────────────
    const totalPredicted = graph.meta.totalPredictedRoutes ?? 0
    const confirmed = graph.meta.confirmedPredictions ?? 0
    const routeScore = totalPredicted === 0
      ? 100
      : Math.round((confirmed / totalPredicted) * 100)
    const routeNotes = totalPredicted === 0
      ? 'No route predictions made'
      : `${confirmed} of ${totalPredicted} predicted routes confirmed`

    if (totalPredicted > 0) {
      flags.push(`INFO:  route prediction — ${confirmed} confirmed, ${totalPredicted - confirmed} discarded`)
    }

    // ── Overall score ──────────────────────────────────────────────────────────
    const overall = Math.round(
      coverageScore    * 0.35 +
      interactionScore * 0.25 +
      graphScore       * 0.25 +
      routeScore       * 0.15
    )

    // ── Spec quality (LLM) ─────────────────────────────────────────────────────
    let specQuality: SpecQuality | null = null
    if (smartLLM) {
      try {
        // Only evaluate nodes that have specs written (unannotated nodes skew the score down)
        const annotatedNodes = Object.values(nodes).filter(n => n.spec?.intent)
        const sampleNodes = annotatedNodes.slice(0, 5)
        // Only show elements with specs written — evaluating (none) entries unfairly tanks the score
        const annotatedElems = allElements.filter(e => e.spec?.description && !isGlobalChrome(e))
        const sampleElements = annotatedElems.slice(0, 12)

        const nodeSpecLines = sampleNodes.map(n => {
          const pre = n.spec?.precondition ? `\n  precondition: "${n.spec.precondition}"` : ''
          const out = n.spec?.expectedOutcome ? `\n  expectedOutcome: "${n.spec.expectedOutcome}"` : ''
          return `Page: "${n.title}"\n  intent: "${n.spec?.intent ?? '(none)'}"`  + pre + out
        }).join('\n\n')
        const elemSpecLines = sampleElements.map(e => {
          const out = e.spec?.expectedOutcome ? `  → expectedOutcome: "${e.spec.expectedOutcome}"` : ''
          return `Element: "${e.name}" (${e.elementType})\n  description: "${e.spec?.description}"${out ? '\n' + out : ''}`
        }).join('\n\n')

        const prompt = ChatPromptTemplate.fromMessages([
          ['system', `You are evaluating whether these web application specs are clear enough
for a test automation step planner to generate accurate click-level test steps from them.

A good spec:
- Page intent names what the user does AND what page comes before/after
- Page precondition describes what must be true before arrival
- Page expectedOutcome describes what the tester should observe after all actions complete
- Element description is SPECIFIC: names options for selects, gives example values for textboxes,
  states business meaning for checkboxes, names what a button triggers
- Element expectedOutcome describes the visible change after interaction
- Avoids vague descriptions like "a button", "shows content", "allows user to select"

Rate the overall spec quality 0–100 and recommend one of:
- ready: step planner can use these as-is
- review_required: some specs need human correction first (minor gaps)
- recrawl_recommended: spec quality too low, re-crawl needed (most specs are vague or missing)`],
          ['human', `Page specs:\n{nodeSpecs}\n\nElement specs:\n{elemSpecs}`],
        ])

        const structured = (smartLLM as any).withStructuredOutput(SpecQualitySchema)
        const chain = prompt.pipe(structured)
        specQuality = await chain.invoke({ nodeSpecs: nodeSpecLines, elemSpecs: elemSpecLines }) as SpecQuality
      } catch {
        // spec quality is optional — never block eval
      }
    }

    // ── Print summary ──────────────────────────────────────────────────────────
    const warnCount  = flags.filter(f => f.startsWith('WARN')).length
    const errorCount = flags.filter(f => f.startsWith('ERROR')).length
    const specLabel  = specQuality ? `${specQuality.score}/100 — ${specQuality.recommendation}` : 'skipped (LLM disabled)'

    log.info('EVAL', `Coverage:             ${coverageScore}/100 — ${coverageNotes}`)
    log.info('EVAL', `Interaction accuracy: ${interactionScore}/100 — ${interactionNotes}`)
    log.info('EVAL', `Graph quality:        ${graphScore}/100 — ${graphNotes}`)
    log.info('EVAL', `Route prediction:     ${routeScore}/100 — ${routeNotes}`)
    log.info('EVAL', `Spec quality (LLM):   ${specLabel}`)
    log.info('EVAL', '──────────────────────────────────────────────')
    log.info('EVAL', `Overall score:        ${overall}/100  Grade: ${grade(overall)}`)
    log.info('EVAL', `Flags: ${warnCount} warnings, ${errorCount} errors`)
    log.info('EVAL', 'Eval written → graph.meta.eval')

    if (overall < 60) {
      log.warn('EVAL', 'Score below threshold — review flags before running step planner')
    }

    return {
      score: overall,
      grade: grade(overall),
      dimensions: {
        coverage:            { score: coverageScore,    notes: coverageNotes },
        interactionAccuracy: { score: interactionScore, notes: interactionNotes },
        graphQuality:        { score: graphScore,       notes: graphNotes },
        routePrediction:     { score: routeScore,       notes: routeNotes },
      },
      specQuality,
      flags,
      evaluatedAt,
    }
  } catch (err: any) {
    flags.push(`ERROR: eval failed internally — ${err.message}`)
    return {
      score: 0,
      grade: 'F',
      dimensions: {
        coverage:            { score: 0, notes: 'Eval error' },
        interactionAccuracy: { score: 0, notes: 'Eval error' },
        graphQuality:        { score: 0, notes: 'Eval error' },
        routePrediction:     { score: 0, notes: 'Eval error' },
      },
      specQuality:  null,
      flags,
      evaluatedAt,
    }
  }
}
