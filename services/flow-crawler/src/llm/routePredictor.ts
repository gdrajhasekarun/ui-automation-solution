/**
 * routePredictor.ts
 * At each dead end, sends the current graph (nodes + edges + specs +
 * already-walked paths) to the smart LLM and receives an ordered list
 * of predicted unexplored routes. Each route is a sequence of
 * (nodeId, elementId, action) tuples. The crawler validates each
 * prediction — only confirmed routes enter the graph.
 */
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { ChatPromptTemplate } from '@langchain/core/prompts'
import type { Graph, PredictedRoute, PathStep } from '../types.js'
import { RoutePredictionSchema } from '../types.js'

interface RouteRequest {
  currentGraph: Graph
  alreadyWalked: Array<{ pathId: string; steps: PathStep[] }>
  maxRoutes: number
}

export async function predictRoutes(
  request: RouteRequest,
  smartLLM: BaseChatModel,
): Promise<PredictedRoute[]> {
  try {
    const { currentGraph, alreadyWalked, maxRoutes } = request

    // Build condensed graph snapshot
    const nodeLines = Object.entries(currentGraph.nodes).map(([id, node]) => {
      const intent = node.spec?.intent ?? node.description ?? node.title
      const elLines = node.elements.slice(0, 15).map(e => {
        const desc = e.spec?.description ?? e.name
        return `    id=${e.id} type=${e.elementType} name="${e.name}" desc="${desc}"`
      }).join('\n')
      return `node: ${id}\n  url: ${node.url}\n  intent: ${intent}\n  elements:\n${elLines}`
    }).join('\n\n')

    const edgeLines = currentGraph.edges.map(e =>
      `${e.from} --[${e.trigger.type}:${e.trigger.elementName ?? e.trigger.elementId}]--> ${e.to}`
    ).join('\n')

    const walkedLines = alreadyWalked.slice(0, 20).map(p => {
      const steps = p.steps.map(s =>
        `  ${s.nodeId} → element:${s.decision.elementId} action:${s.decision.action} value:${s.decision.value ?? ''}`
      ).join('\n')
      return `pathId: ${p.pathId}\n${steps}`
    }).join('\n\n')

    const prompt = ChatPromptTemplate.fromMessages([
      ['system', `You are analyzing a web application graph to find unexplored user flows.
The graph shows pages (nodes), their elements, and transitions (edges).
Each node and element has a spec describing its purpose.
The alreadyWalked list shows interaction sequences already performed.

Your task: predict interaction sequences that would reach new DOM states
not yet in the graph. Order by confidence — most likely first.
Only suggest routes through elements that exist in the graph.
Do not suggest routes identical to already-walked paths.
Return at most {maxRoutes} routes.`],
      ['human', `Graph nodes:\n{nodes}\n\nEdges:\n{edges}\n\nAlready walked paths:\n{walked}\n\nPredict up to {maxRoutes} unexplored routes.`],
    ])

    const structured = (smartLLM as any).withStructuredOutput(RoutePredictionSchema)
    const chain = prompt.pipe(structured)
    const result = await chain.invoke({
      nodes: nodeLines,
      edges: edgeLines,
      walked: walkedLines || '(none yet)',
      maxRoutes: String(maxRoutes),
    }) as { routes: PredictedRoute[] }

    return result.routes ?? []
  } catch {
    return []
  }
}
