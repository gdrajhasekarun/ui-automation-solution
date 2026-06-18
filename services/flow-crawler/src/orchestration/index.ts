export { runFromPage, runCrawlLoop } from './flowRunner.js'
export { BranchQueue } from './branchQueue.js'
export { PathManager }  from './pathManager.js'

import { chromium } from 'playwright'
import * as path from 'path'
import * as fs from 'fs'
import type { CrawlerConfig, RequestPayload, Node } from '../types.js'
import { CrawlerGraph as Graph } from '../graph/index.js'
import { CrawlDataCache } from '../cache/index.js'
import { readExcel } from '../data/index.js'
import { buildLLMPair, parseNotes, summarizeGraph } from '../llm/index.js'
import { runCrawlLoop } from './flowRunner.js'
import { log } from '../logger.js'

function loadExistingNodes(outputFile: string): Record<string, Node> {
  try {
    if (!fs.existsSync(outputFile)) return {}
    const data = JSON.parse(fs.readFileSync(outputFile, 'utf8'))
    return (data.nodes ?? {}) as Record<string, Node>
  } catch {
    return {}
  }
}

export interface CrawlResult {
  outputFile:     string
  nodeCount:      number
  edgeCount:      number
  unfilledFields: number
  llmCallCount:   number
  cacheHitCount:  number
  summary?:       string
}

export async function runCrawl(config: CrawlerConfig, payload: RequestPayload): Promise<CrawlResult> {
  const outputDir  = path.resolve(config.outputDir, config.appId)
  const outputFile = path.join(outputDir, 'graph.json')

  const graph = new Graph(config.appId, config.seedUrl)
  const cache = new CrawlDataCache(path.resolve(config.cacheFile))

  // Load existing graph nodes so pageRef names can be reused for similar pages
  const existingNodes = loadExistingNodes(outputFile)
  const existingNodeCount = Object.keys(existingNodes).length
  if (existingNodeCount > 0) {
    log.info('CRAWL', `Loaded ${existingNodeCount} existing nodes for pageRef reuse`)
    graph.seedPageRefNames(existingNodes)
  }

  // Load external data sources
  const excelData = readExcel(path.resolve(config.excelFile))
  log.info('CRAWL', `Excel: ${excelData.credentials.length} credentials, ${excelData.formFills.length} field mappings`)

  // LLM setup
  const llmPair = config.llm.enabled ? await buildLLMPair(config) : null
  const smartLLM = llmPair?.smartLLM ?? null
  const fastLLM  = llmPair?.fastLLM  ?? null

  if (!config.llm.enabled) log.warn('CRAWL', 'LLM disabled — Phase A will use static/Excel values only')
  else if (!smartLLM)       log.warn('CRAWL', 'LLM failed to load — check API key in .env')
  else                      log.success('CRAWL', `LLM ready — smart: ${config.llm.smartModel}  fast: ${config.llm.fastModel}`)

  // Parse crawl notes at startup
  const notesPath = path.resolve('./crawl-notes.md')
  const notes = smartLLM ? await parseNotes(notesPath, smartLLM) : { generalRules: [], skipSelectors: [], fieldHints: {} }

  log.phase(`Flow Crawler — ${config.appId}`)
  log.info('CRAWL', `Seed: ${config.seedUrl}  headless: ${config.headless}  maxDepth: ${config.maxDepth}`)

  const browser = await chromium.launch({
    headless: config.headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--flag-switches-begin',
      '--disable-site-isolation-trials',
      '--flag-switches-end',
    ],
  })
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport:  { width: 1440, height: 900 },
    locale:    'en-US',
    timezoneId: 'America/New_York',
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
    },
  })
  // Mask webdriver flag that bot-detection scripts look for
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] })
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Array
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Promise
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Symbol
  })

  let crawlError: Error | undefined
  try {
    await runCrawlLoop(context, config, graph, excelData, notes, cache, smartLLM, fastLLM, existingNodes)
    await cache.flush()
  } catch (err: any) {
    crawlError = err
    log.error('CRAWL', `Error during crawl: ${err.message}`)
  } finally {
    await browser.close()
  }

  // Always write whatever was captured, even on error
  try {
    const summary = !crawlError && smartLLM ? await summarizeGraph(graph, smartLLM) : undefined
    if (summary) graph.setSummary(summary)
    await graph.writeToFile(outputFile)
    log.info('CRAWL', `Output: ${outputFile}  (nodes: ${graph.nodeCount}  edges: ${graph.edgeCount})`)
  } catch (writeErr: any) {
    log.error('CRAWL', `Failed to write graph: ${writeErr.message}`)
  }

  if (crawlError) throw crawlError

  log.success('CRAWL', `Complete — nodes: ${graph.nodeCount}  edges: ${graph.edgeCount}  unfilled: ${graph.unfilledCount}`)

  return {
    outputFile,
    nodeCount:      graph.nodeCount,
    edgeCount:      graph.edgeCount,
    unfilledFields: graph.unfilledCount,
    llmCallCount:   graph.llmCallCount,
    cacheHitCount:  graph.cacheHitCount,
  }
}
