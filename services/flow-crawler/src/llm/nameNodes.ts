/**
 * nameNodes.ts
 * Assigns a stable `className` to every graph node using spec.intent.
 *
 * Strategy:
 * 1. Load cache from disk (keyed by nodeId → className).
 * 2. Cache hit → use stored name (frozen; survives re-crawls).
 * 3. Cache miss + spec.intent present → ask LLM for a short PascalCase class name.
 * 4. Cache miss + no spec.intent → fall back to deriveClassName(pageRef).
 * 5. Write className onto node via graph.updateNode and flush cache.
 *
 * This replaces the deterministic deriveClassName call in annotate.ts that was
 * deriving names from pageRef headings, which caused collisions (Page2/Page3)
 * when two pages shared the same heading text.
 */

import * as fs from 'fs'
import * as path from 'path'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { CrawlerGraph } from '../graph/index.js'
import { deriveClassName } from '../graph/index.js'
import { log } from '../logger.js'

type NodeNameCache = Record<string, string> // nodeId → className

function cachePathForGraph(graph: CrawlerGraph): string {
  const appId = graph.toJSON().meta?.appId
  if (appId) {
    return path.resolve(`../../shared/outputs/${appId}/node_names.cache.json`)
  }
  return path.resolve('./node_names.cache.json')
}

function loadCache(cachePath: string): NodeNameCache {
  try {
    if (fs.existsSync(cachePath)) {
      return JSON.parse(fs.readFileSync(cachePath, 'utf8'))
    }
  } catch { /* ignore */ }
  return {}
}

function saveCache(cachePath: string, cache: NodeNameCache): void {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true })
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2))
  } catch (err: any) {
    log.warn('NAME_NODES', `Failed to save cache: ${err.message}`)
  }
}

function toPascalCase(raw: string): string {
  // If LLM returned already-PascalCase (no spaces), just strip non-alphanumeric and return
  const noSpaces = raw.trim().replace(/[^a-zA-Z0-9]/g, '')
  if (noSpaces.length === 0) return ''
  // Ensure first char is uppercase, preserve rest as-is (LLM already set casing)
  return noSpaces.charAt(0).toUpperCase() + noSpaces.slice(1)
}

function ensurePageSuffix(name: string): string {
  // Collapse any number of trailing "Page" repetitions down to exactly one
  const base = name.replace(/(Page)+$/i, '')
  return base + 'Page'
}

const NAME_NODES_PROMPT = `Given the page intent below, produce a short descriptive PascalCase Java class name ending in "Page".
Rules:
- 2–5 meaningful words (excluding "Page" suffix)
- Describe WHAT the page does, not the specific data entered during testing
- NO specific values, codes, IDs, or numbers (e.g. "99213", "John Doe") — use the field/concept name instead
- Avoid generic names like "SearchPage" alone — include the subject matter
- No articles, prepositions, or conjunctions
- Return ONLY the class name, nothing else

Intent: `

export async function nameNodes(
  graph: CrawlerGraph,
  fastLLM: BaseChatModel | null,
): Promise<void> {
  const cachePath = cachePathForGraph(graph)
  const cache = loadCache(cachePath)
  const graphData = graph.toJSON()
  let cacheUpdated = false

  for (const [nodeId, node] of Object.entries(graphData.nodes)) {
    // Cache hit — name is frozen
    if (cache[nodeId]) {
      if (node.className !== cache[nodeId]) {
        graph.updateNode(nodeId, { className: cache[nodeId] })
      }
      continue
    }

    let className: string

    // Use spec.intent if available; fall back to pageRef/title so LLM still produces a good name
    const intent = node.spec?.intent
    const pageRef = node.pageRef ?? node.title ?? ''
    const llmInput = intent
      ? intent
      : `Page titled "${pageRef}"` + (node.url ? ` at URL: ${node.url}` : '')

    if (fastLLM) {
      try {
        const response = await fastLLM.invoke(NAME_NODES_PROMPT + llmInput)
        const raw = (typeof response === 'string' ? response : (response as any).content ?? '').trim()
        const pascal = toPascalCase(raw)
        className = ensurePageSuffix(pascal || deriveClassName(pageRef))
      } catch (err: any) {
        log.warn('NAME_NODES', `LLM class name failed for ${nodeId}: ${err.message?.slice(0, 100)}`)
        className = deriveClassName(pageRef)
      }
    } else {
      className = deriveClassName(pageRef)
    }

    cache[nodeId] = className
    cacheUpdated = true
    graph.updateNode(nodeId, { className })
    log.info('NAME_NODES', `  ${nodeId} → ${className}`)
  }

  if (cacheUpdated) {
    saveCache(cachePath, cache)
    log.info('NAME_NODES', `Cache updated → ${cachePath}`)
  }
}
