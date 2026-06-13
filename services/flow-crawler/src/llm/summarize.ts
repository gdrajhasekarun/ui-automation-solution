import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { ChatPromptTemplate } from '@langchain/core/prompts'
import type { CrawlerGraph } from '../graph/index.js'

export async function summarizeGraph(graph: CrawlerGraph, llm: BaseChatModel): Promise<string> {
  const data = graph.toJSON()
  const nodeList = Object.values(data.nodes)
    .slice(0, 30)
    .map(n => `- ${n.title || n.normalizedUrl} (${n.elements.length} elements)`)
    .join('\n')

  try {
    const prompt = ChatPromptTemplate.fromMessages([
      ['system', 'You are a technical writer. Summarize this web application crawl in 2-3 sentences. Focus on what flows were discovered, how many pages, and notable patterns.'],
      ['human', `Crawl stats:
Nodes: {nodeCount}
Edges: {edgeCount}
Unfilled fields: {unfilledCount}
LLM calls: {llmCallCount}
Cache hits: {cacheHitCount}

Sample pages:
{nodeList}`],
    ])

    const chain = prompt.pipe(llm)
    const result = await chain.invoke({
      nodeCount:    data.meta.totalNodes,
      edgeCount:    data.meta.totalEdges,
      unfilledCount: data.meta.unfilledFields,
      llmCallCount: data.meta.llmCallCount,
      cacheHitCount: data.meta.cacheHitCount,
      nodeList,
    })
    return typeof result.content === 'string' ? result.content : JSON.stringify(result.content)
  } catch {
    return `Crawl complete: ${data.meta.totalNodes} nodes, ${data.meta.totalEdges} edges discovered.`
  }
}
