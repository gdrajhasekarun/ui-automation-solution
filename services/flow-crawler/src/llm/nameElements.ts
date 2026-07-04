/**
 * nameElements.ts
 * Assigns a stable `uniqueName` to every element in the graph.
 *
 * Strategy (cost-efficient):
 * 1. Load cache from disk (keyed by _selector → uniqueName).
 * 2. Deterministic pass: candidateName = label + TypeSuffix for each uncached element.
 * 3. Group by candidateName — collision groups (≥2 elements) go to LLM.
 * 4. LLM returns location-based labels for collision groups only.
 * 5. Write uniqueName onto each element and flush cache.
 */

import * as fs from 'fs'
import * as path from 'path'
import { z } from 'zod'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { CrawlerGraph } from '../graph/index.js'
import { log } from '../logger.js'

// ── Type suffix map ───────────────────────────────────────────────────────────

const TYPE_SUFFIX: Record<string, string> = {
  textbox:      'TextBox',
  textarea:     'TextBox',
  search:       'TextBox',
  button:       'Button',
  submit:       'Button',
  select:       'Select',
  combobox:     'Select',
  checkbox:     'CheckBox',
  radio:        'RadioButton',
  link:         'Link',
}

function typeSuffix(elementType: string): string {
  return TYPE_SUFFIX[elementType] ?? 'Element'
}

function candidateName(label: string, elementType: string): string {
  const base = label.trim() || 'Element'
  return `${base} ${typeSuffix(elementType)}`
}

// ── Cache helpers ─────────────────────────────────────────────────────────────

type NameCache = Record<string, string> // selectorKey → uniqueName

function cachePathForGraph(graph: CrawlerGraph): string {
  const appId = graph.toJSON().meta?.appId
  if (appId) {
    return path.resolve(`../../shared/outputs/${appId}/name_elements.cache.json`)
  }
  return path.resolve('./name_elements.cache.json')
}

function loadCache(cachePath: string): NameCache {
  try {
    if (fs.existsSync(cachePath)) {
      return JSON.parse(fs.readFileSync(cachePath, 'utf8'))
    }
  } catch { /* ignore */ }
  return {}
}

function saveCache(cachePath: string, cache: NameCache): void {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true })
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2))
  } catch (err: any) {
    log.warn('NAME_ELEMENTS', `Failed to save cache: ${err.message}`)
  }
}

// ── LLM schema ────────────────────────────────────────────────────────────────

const DisambiguationSchema = z.object({
  names: z.array(z.object({
    elementId: z.string(),
    uniqueName: z.string(),
  })),
})

// ── Main export ───────────────────────────────────────────────────────────────

export async function nameElements(
  graph: CrawlerGraph,
  fastLLM: BaseChatModel | null,
): Promise<void> {
  if (!fastLLM) return

  const cachePath = cachePathForGraph(graph)
  const cache = loadCache(cachePath)
  const graphData = graph.toJSON()
  let cacheUpdated = false

  for (const [nodeId, node] of Object.entries(graphData.nodes)) {
    if (!node.elements?.length) continue
    const pageRef = node.pageRef ?? node.title ?? nodeId

    // Step 1: resolve uniqueName from cache or compute candidate
    type ElemMeta = { id: string; selector: string; label: string; elementType: string; boundingBox: unknown; href: string | null }
    const pendingElems: Array<ElemMeta & { candidate: string }> = []

    for (const elem of node.elements) {
      const selector = elem._selector ?? ''
      if (selector && cache[selector]) {
        // Cache hit — will be applied in the updateNode batch below; skip to next
        continue
      }
      const label = elem.label ?? elem.name ?? ''
      const candidate = candidateName(label, elem.elementType)
      pendingElems.push({ id: elem.id, selector, label, elementType: elem.elementType, boundingBox: elem.boundingBox, href: elem.href ?? null, candidate })
    }

    if (!pendingElems.length) continue

    // Step 2: group by candidate — find collisions
    const groups = new Map<string, typeof pendingElems>()
    for (const e of pendingElems) {
      if (!groups.has(e.candidate)) groups.set(e.candidate, [])
      groups.get(e.candidate)!.push(e)
    }

    const resolvedNames = new Map<string, string>() // elementId → uniqueName

    // Non-colliding: deterministic
    for (const [candidate, group] of groups) {
      if (group.length === 1) {
        resolvedNames.set(group[0].id, candidate)
      }
    }

    // Colliding: ask LLM
    const collisionGroups = [...groups.entries()].filter(([, g]) => g.length > 1)
    if (collisionGroups.length > 0 && fastLLM) {
      for (const [, group] of collisionGroups) {
        const elemList = group.map(e => {
          const bb = e.boundingBox as { x?: number; y?: number } | null
          return {
            elementId: e.id,
            name: e.label || e.elementType,
            elementType: e.elementType,
            x: bb?.x ?? 0,
            y: bb?.y ?? 0,
            href: e.href,
          }
        })

        const prompt =
          `Page: "${pageRef}"
These elements share the same base name and need unique location-based labels.
Convention: [location/purpose] [Type]
  Type must be one of: TextBox | Button | Link | Select | CheckBox | RadioButton
  Use page location (y=small→top, y=large→bottom; x=small→left) to differentiate duplicates.
  Examples: "Hero Search TextBox", "Footer Search TextBox", "Submit Button", "Cancel Button"
  2–4 words total. No underscores.

Return JSON: { "names": [{ "elementId": "...", "uniqueName": "..." }] }

Elements:
${JSON.stringify(elemList, null, 2)}`

        try {
          const result = await (fastLLM as any).withStructuredOutput(DisambiguationSchema).invoke(prompt)
          for (const { elementId, uniqueName } of result.names) {
            resolvedNames.set(elementId, uniqueName)
          }
        } catch (err: any) {
          log.warn('NAME_ELEMENTS', `LLM disambiguation failed for page "${pageRef}": ${err.message?.slice(0, 100)}`)
          // Fall back to candidate + ordinal
          group.forEach((e, i) => resolvedNames.set(e.id, i === 0 ? e.candidate : `${e.candidate} ${i + 1}`))
        }
      }
    }

    // Step 3: apply uniqueName onto all node elements and update cache
    const pendingById = new Map(pendingElems.map(e => [e.id, e]))
    const updatedElements = node.elements.map(elem => {
      const selector = elem._selector ?? ''
      // Cache hit path
      if (selector && cache[selector] && !pendingById.has(elem.id)) {
        return elem.uniqueName === cache[selector] ? elem : { ...elem, uniqueName: cache[selector] }
      }
      // Newly resolved
      const meta = pendingById.get(elem.id)
      if (!meta) return elem
      const name = resolvedNames.get(elem.id)
      if (!name) return elem
      if (meta.selector) {
        cache[meta.selector] = name
        cacheUpdated = true
      }
      return { ...elem, uniqueName: name }
    })
    graph.updateNode(nodeId, { elements: updatedElements } as any)
  }

  if (cacheUpdated) {
    saveCache(cachePath, cache)
    log.info('NAME_ELEMENTS', `Cache updated → ${cachePath}`)
  }
}
