import * as fs from 'fs'
import * as path from 'path'
import type { Node, Edge, Graph, UILibrary, CapturedElement } from '../types.js'
import { edgeId, nodeId, normalizeUrl } from './urlNormalizer.js'

const GENERIC_LABELS = new Set([
  'select a language english', 'select a language', 'close', 'cancel', 'back',
  'skip', 'pause', 'play', 'play/pause', 'next', 'previous', 'menu', 'home',
  'click for accessibility menu', 'sitemap', 'font decrease', 'font increase',
])

export function derivePageRef(title: string, elements: CapturedElement[]): string {
  // Pull primary action elements — buttons and links with meaningful labels
  const actions = elements
    .filter(e => e.elementType === 'button' || e.elementType === 'link')
    .map(e => e.name.trim())
    .filter(label => label.length > 1 && !GENERIC_LABELS.has(label.toLowerCase()))

  // Pull form fields to describe data-entry pages
  const fields = elements
    .filter(e => e.elementType === 'textbox' || e.elementType === 'textarea' ||
                 e.elementType === 'select'  || e.elementType === 'combobox')
    .map(e => e.name.trim())
    .filter(label => label.length > 1)

  // Build ref: title + top distinctive actions/fields
  const parts: string[] = []

  if (fields.length > 0) {
    parts.push(fields.slice(0, 2).join(' + '))
  }

  const actionPart = actions.slice(0, 3).join(' | ')
  if (actionPart) parts.push(actionPart)

  const suffix = parts.join(' — ')
  return suffix ? `${title} [${suffix}]` : title
}

export class CrawlerGraph {
  private nodes = new Map<string, Node>()
  private edges: Edge[] = []
  private edgeSet = new Set<string>()
  private _llmCallCount = 0
  private _cacheHitCount = 0
  private _summary?: string

  private pageRefNames = new Set<string>()

  constructor(
    private readonly appId: string,
    private readonly seedUrl: string,
  ) {}

  hasNode(id: string): boolean { return this.nodes.has(id) }
  getNode(id: string): Node | undefined { return this.nodes.get(id) }

  /** Seed known pageRef names from a previously loaded graph so uniqueness is enforced across runs */
  seedPageRefNames(existingNodes: Record<string, { pageRef?: string }>): void {
    for (const node of Object.values(existingNodes)) {
      if (node.pageRef) this.pageRefNames.add(node.pageRef.toLowerCase())
    }
  }

  /** Current set of used pageRef names — pass to LLM so it avoids collisions */
  get usedPageRefNames(): Set<string> { return this.pageRefNames }

  /** Register a pageRef as used. Returns the name unchanged. */
  registerPageRef(name: string): string {
    this.pageRefNames.add(name.toLowerCase())
    return name
  }

  addNode(id: string, data: Node): boolean {
    if (this.nodes.has(id)) return false
    this.nodes.set(id, data)
    return true
  }

  updateNode(id: string, partial: Partial<Node>): void {
    const existing = this.nodes.get(id)
    if (existing) this.nodes.set(id, { ...existing, ...partial })
  }

  addEdge(opts: {
    from: string; to: string
    trigger: Edge['trigger']
    label?: string
  }): void {
    const dedupeKey = `${opts.from}->${opts.to}->${opts.trigger.type}->${opts.trigger.elementId ?? ''}`
    if (this.edgeSet.has(dedupeKey)) return
    this.edgeSet.add(dedupeKey)
    this.edges.push({ id: edgeId(), from: opts.from, to: opts.to, trigger: opts.trigger })
  }

  incrementLLMCalls(n = 1) { this._llmCallCount += n }
  incrementCacheHits(n = 1) { this._cacheHitCount += n }
  setSummary(s: string) { this._summary = s }

  get nodeCount() { return this.nodes.size }
  get edgeCount()  { return this.edges.length }
  get llmCallCount()  { return this._llmCallCount }
  get cacheHitCount() { return this._cacheHitCount }

  get unfilledCount(): number {
    let n = 0
    for (const node of this.nodes.values()) n += (node.unfilledFields ?? []).length
    return n
  }

  dominantLibrary(): UILibrary {
    const counts = new Map<UILibrary, number>()
    for (const node of this.nodes.values()) {
      counts.set(node.uiLibrary, (counts.get(node.uiLibrary) ?? 0) + 1)
    }
    let best: UILibrary = 'unknown'
    let bestCount = 0
    for (const [lib, count] of counts) {
      if (count > bestCount) { best = lib; bestCount = count }
    }
    return best
  }

  toJSON(): Graph {
    return {
      meta: {
        crawledAt:      new Date().toISOString(),
        seedUrl:        this.seedUrl,
        appId:          this.appId,
        uiLibrary:      this.dominantLibrary(),
        totalNodes:     this.nodes.size,
        totalEdges:     this.edges.length,
        unfilledFields: this.unfilledCount,
        llmCallCount:   this._llmCallCount,
        cacheHitCount:  this._cacheHitCount,
        summary:        this._summary,
        source:         'flow-crawler',
      },
      nodes: Object.fromEntries(this.nodes),
      edges: this.edges,
    }
  }

  async writeToFile(filePath: string): Promise<void> {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(this.toJSON(), null, 2), 'utf8')
  }
}

export { normalizeUrl, nodeId, edgeId, pageFingerprint } from './urlNormalizer.js'
