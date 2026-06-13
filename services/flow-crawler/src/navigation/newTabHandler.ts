import type { Page } from 'playwright'
import { log } from '../logger.js'
import type { CrawlerGraph } from '../graph/index.js'
import type { CrawlerConfig } from '../types.js'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { normalizeUrl, nodeId, pageFingerprint } from '../graph/index.js'
import { capturePageElements, detectUILibrary } from '../capture/index.js'
import { namePageRef } from '../llm/index.js'
import { recordEdge } from './edgeTracker.js'

export async function captureNewTab(
  newPage: Page,
  fromNodeId: string,
  fromElementId: string,
  fromElementName: string | null,
  graph: CrawlerGraph,
  config: CrawlerConfig,
  runFromPage: (page: Page, nodeId: string, graph: CrawlerGraph, config: CrawlerConfig) => Promise<void>,
  llm?: BaseChatModel | null,
): Promise<string> {
  try {
    await newPage.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})

    const url      = newPage.url()
    const normUrl  = normalizeUrl(url)
    const id       = nodeId(normUrl)

    if (graph.hasNode(id)) {
      recordEdge(graph, fromNodeId, url, {
        type:         'new_tab',
        semanticType: 'navigate',
        elementId:    fromElementId,
        elementName:  fromElementName,
      })
      await newPage.close()
      return id
    }

    const library  = await detectUILibrary(newPage)
    const elements = await capturePageElements(newPage, library)
    const title    = await newPage.title()
    const fp       = pageFingerprint(elements.map(e => e.id))

    const pageRef = llm
      ? await namePageRef(title, url, elements, llm, {}, graph.usedPageRefNames)
          .then(r => { graph.incrementLLMCalls(); return graph.registerPageRef(r) })
      : graph.registerPageRef(title)

    graph.addNode(id, {
      url, normalizedUrl: normUrl, title, pageRef,
      fingerprint: fp, uiLibrary: library,
      elements, unfilledFields: [],
    })

    recordEdge(graph, fromNodeId, url, {
      type:         'new_tab',
      semanticType: 'navigate',
      elementId:    fromElementId,
      elementName:  fromElementName,
    })

    log.info('NEW_TAB', `Node added: ${id}  pageRef="${pageRef}"  (${normUrl})`)

    await runFromPage(newPage, id, graph, config)
  } finally {
    await newPage.close().catch(() => {})
  }

  return nodeId(normalizeUrl(newPage.url()))
}
