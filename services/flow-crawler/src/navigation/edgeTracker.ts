import type { CrawlerGraph } from '../graph/index.js'
import type { Edge } from '../types.js'
import { normalizeUrl, nodeId } from '../graph/index.js'

export function recordEdge(
  graph: CrawlerGraph,
  fromNodeId: string,
  toUrl: string,
  trigger: Edge['trigger'],
): string {
  const normUrl = normalizeUrl(toUrl)
  const toNodeId = nodeId(normUrl)
  graph.addEdge({ from: fromNodeId, to: toNodeId, trigger })
  return toNodeId
}
