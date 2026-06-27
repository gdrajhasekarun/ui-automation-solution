import * as fs from 'fs'
import * as path from 'path'
import type { Node, Edge, Graph, UILibrary, CapturedElement, Eval } from '../types.js'
import { edgeId, nodeId, normalizeUrl } from './urlNormalizer.js'

// ── Global element extraction threshold ───────────────────────────────────────
// An element is promoted to globalElements if its stableId appears in at least
// this fraction of all nodes OR in at least MIN_COUNT nodes (whichever is looser).
const GLOBAL_THRESHOLD_RATIO = 0.5
const GLOBAL_THRESHOLD_MIN   = 3

/**
 * Re-hydrate node.elements from globalElements + node.ownElements when reading
 * a graph.json that was written in the split format.
 * Safe to call on old-format graphs (no-op if ownElements is absent).
 */
export function hydrateGraphNodes(raw: Graph): Graph {
  const globals = raw.globalElements ?? {}
  for (const node of Object.values(raw.nodes)) {
    if (node.ownElements !== undefined) {
      const inherited = (node.inheritedElementIds ?? [])
        .map(id => globals[id])
        .filter((e): e is CapturedElement => !!e)
      node.elements = [...inherited, ...node.ownElements]
    }
    // Old-format graphs already have node.elements — leave them untouched
  }
  return raw
}

// ── Branch condition inference ─────────────────────────────────────────────────
// Maps URL path keywords to semantic condition names so that branching edges
// get a human-readable label (e.g. "unauthenticated") instead of a raw URL.
// Checked in order — first match wins.
const CONDITION_PATTERNS: Array<{ pattern: RegExp; condition: string }> = [
  { pattern: /\b(login|sign[-_]?in|signin|auth)\b/i,          condition: 'unauthenticated' },
  { pattern: /\b(logout|sign[-_]?out|signout)\b/i,            condition: 'authenticated' },
  { pattern: /\b(register|sign[-_]?up|signup|create[-_]?account)\b/i, condition: 'unregistered' },
  { pattern: /\b(error|denied|forbidden|403|404|500)\b/i,     condition: 'error' },
  { pattern: /\b(success|confirm|thank[-_]?you|complete)\b/i, condition: 'success' },
  { pattern: /\b(dashboard|home|portal|member)\b/i,           condition: 'authenticated' },
]

function inferCondition(url: string): string {
  for (const { pattern, condition } of CONDITION_PATTERNS) {
    if (pattern.test(url)) return condition
  }
  return 'conditional'
}

const GENERIC_LABELS = new Set([
  'select a language english', 'select a language', 'close', 'cancel', 'back',
  'skip', 'pause', 'play', 'play/pause', 'next', 'previous', 'menu', 'home',
  'click for accessibility menu', 'sitemap', 'font decrease', 'font increase',
])

export function deriveClassName(pageRef: string): string {
  const words = pageRef
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
  const base = words.join('')
  return base.endsWith('Page') ? base : base + 'Page'
}

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
  private seededNodeIds = new Set<string>()   // tracks nodes loaded from prior graph (not visited this run)
  private edges: Edge[] = []
  private edgeSet = new Set<string>()
  private _cacheHitCount = 0
  private _summary?: string
  private _eval?: Eval
  private _llmUsage?: Graph['meta']['llmUsage']
  private _totalPredictedRoutes = 0
  private _confirmedPredictions = 0
  private _crawlErrors = 0
  private _annotatedAt?: string

  // Global element registry — populated by extractGlobalElements() before write
  readonly globalElements = new Map<string, CapturedElement>()

  private pageRefNames = new Set<string>()

  constructor(
    private readonly appId: string,
    private readonly seedUrl: string,
  ) {}

  hasNode(id: string): boolean { return this.nodes.has(id) }
  getNode(id: string): Node | undefined { return this.nodes.get(id) }

  /** Find a node whose element fingerprint matches — used to merge nodes reachable via different URLs */
  findNodeByFingerprint(fp: string): string | null {
    for (const [id, node] of this.nodes) {
      if (node.fingerprint === fp) return id
    }
    return null
  }

  /** Seed known pageRef names from a previously loaded graph so uniqueness is enforced across runs */
  seedPageRefNames(existingNodes: Record<string, { pageRef?: string }>): void {
    for (const node of Object.values(existingNodes)) {
      if (node.pageRef) this.pageRefNames.add(node.pageRef.toLowerCase())
    }
  }

  /** Seed prior nodes from a previous graph so edges always have valid targets.
   *  Current-run nodes (added via addNode) always overwrite seeded ones. */
  seedNodes(existingNodes: Record<string, Node>): void {
    for (const [id, node] of Object.entries(existingNodes)) {
      if (!this.nodes.has(id)) {
        this.nodes.set(id, node)
        this.seededNodeIds.add(id)
      }
    }
  }

  /** Seed globalElements from a prior graph.json so the registry persists across runs */
  seedGlobalElements(existing: Record<string, CapturedElement>): void {
    for (const [id, el] of Object.entries(existing)) {
      if (!this.globalElements.has(id)) this.globalElements.set(id, el)
    }
  }

  /** Seed existing edges from a prior graph.json so branch detection works across runs.
   *  Edges are replayed into this.edges and this.edgeSet so addEdge can detect
   *  when a new crawl run finds a different destination for the same trigger. */
  seedEdges(existingEdges: Edge[]): void {
    for (const e of existingEdges) {
      const dedupeKey = `${e.from}->${e.to}->${e.trigger.type}->${e.trigger.elementId ?? ''}`
      if (this.edgeSet.has(dedupeKey)) continue
      this.edgeSet.add(dedupeKey)
      this.edges.push(e)
    }
  }

  /** Current set of used pageRef names — pass to LLM so it avoids collisions */
  get usedPageRefNames(): Set<string> { return this.pageRefNames }

  /** Register a pageRef as used. Appends a counter on collision. Returns the unique name. */
  registerPageRef(name: string): string {
    const base = name.trim() || 'Untitled'
    if (!this.pageRefNames.has(base.toLowerCase())) {
      this.pageRefNames.add(base.toLowerCase())
      return base
    }
    let counter = 2
    while (this.pageRefNames.has(`${base.toLowerCase()} ${counter}`)) counter++
    const unique = `${base} ${counter}`
    this.pageRefNames.add(unique.toLowerCase())
    return unique
  }

  addNode(id: string, data: Node): boolean {
    const isSeeded = this.seededNodeIds.has(id)
    if (this.nodes.has(id) && !isSeeded) return false  // already visited this run — skip
    const existing = this.nodes.get(id)
    const className = data.className ?? existing?.className
    this.nodes.set(id, className ? { ...data, className } : data)
    this.seededNodeIds.delete(id)  // no longer just seeded — now a real visited node
    return true
  }

  updateNode(id: string, partial: Partial<Node>): void {
    const existing = this.nodes.get(id)
    if (existing) this.nodes.set(id, { ...existing, ...partial })
  }

  /** Find an edge by its from/to/elementId triple — used to check for replay validation */
  findEdge(from: string, to: string, elementId: string): Edge | undefined {
    return this.edges.find(e => e.from === from && e.to === to && e.trigger.elementId === elementId)
  }

  updateEdge(id: string, partial: Partial<Pick<Edge, 'elementDiff' | 'validationResult' | 'spec'>>): void {
    const edge = this.edges.find(e => e.id === id)
    if (edge) Object.assign(edge, partial)
  }

  addEdge(opts: {
    from: string; to: string
    trigger: Edge['trigger']
    label?: string
    condition?: string
    elementDiff?: Edge['elementDiff']
  }): string | null {  // returns edge id so callers can attach elementDiff later
    const dedupeKey = `${opts.from}->${opts.to}->${opts.trigger.type}->${opts.trigger.elementId ?? ''}`
    if (this.edgeSet.has(dedupeKey)) return null
    this.edgeSet.add(dedupeKey)

    // ── Branch detection ────────────────────────────────────────────────────
    // If the same trigger element from the same node already has an edge going
    // to a DIFFERENT destination, both edges are conditional branches.
    // Mark them as branching and infer conditions from the destination URL.
    const triggerKey = `${opts.from}::${opts.trigger.elementId}`
    const existingIdx = this.edges.findIndex(
      e => e.from === opts.from && e.trigger.elementId === opts.trigger.elementId && e.to !== opts.to
    )

    let condition = opts.condition
    if (existingIdx !== -1) {
      // Mark the already-recorded edge as branching and infer its condition
      const existing = this.edges[existingIdx]
      if (!existing.isBranching) {
        existing.isBranching = true
        existing.condition   = existing.condition ?? inferCondition(this.nodes.get(existing.to)?.url ?? '')
      }
      // Infer condition for this new edge
      condition = condition ?? inferCondition(this.nodes.get(opts.to)?.url ?? '')
    }

    const newEdge: Edge = {
      id:          edgeId(),
      from:        opts.from,
      to:          opts.to,
      trigger:     opts.trigger,
      isBranching: existingIdx !== -1 ? true : undefined,
      condition:   condition || undefined,
      elementDiff: opts.elementDiff,
    }
    this.edges.push(newEdge)

    // ── Alternative-path detection ──────────────────────────────────────────
    // If the source node now has more than one outgoing edge (via ANY elements,
    // not just the same one), all of them represent alternative paths and should
    // be flagged so consumers know a choice exists at this node.
    const outgoing = this.edges.filter(e => e.from === opts.from)
    if (outgoing.length > 1) {
      outgoing.forEach(e => { e.isBranching = true })
    }

    return newEdge.id
  }

  incrementCacheHits(n = 1) { this._cacheHitCount += n }
  setSummary(s: string) { this._summary = s }
  setEval(result: Eval): void { this._eval = result }
  setLLMUsage(usage: NonNullable<Graph['meta']['llmUsage']>): void { this._llmUsage = usage }
  setPathIntent(score: number, path: string[]): void {
    if (this._eval) this._eval.pathIntent = { score, stepsRecorded: path.length, path }
  }
  incrementPredictedRoutes(n: number): void { this._totalPredictedRoutes += n }
  incrementConfirmedPredictions(): void { this._confirmedPredictions++ }
  recordCrawlError(): void { this._crawlErrors++ }
  setAnnotatedAt(ts: string): void { this._annotatedAt = ts }

  get nodeCount() { return this.nodes.size }
  get edgeCount()  { return this.edges.length }
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

  /**
   * Promote elements shared across ≥ threshold fraction of nodes (or ≥ MIN_COUNT nodes)
   * into graph.globalElements. Per-node elements are split into:
   *   node.ownElements         — elements unique to this page
   *   node.inheritedElementIds — IDs of global elements that appear on this page
   * node.elements is updated to the merged set so all runtime code stays unchanged.
   */
  extractGlobalElements(): void {
    const allNodes = [...this.nodes.values()]
    const totalNodes = allNodes.length
    if (totalNodes < 2) return  // nothing to share with fewer than 2 pages

    // Count how many nodes each element ID appears in
    const freq = new Map<string, number>()
    for (const node of allNodes) {
      const seen = new Set<string>()
      for (const el of node.elements ?? []) {
        if (!seen.has(el.id)) {
          seen.add(el.id)
          freq.set(el.id, (freq.get(el.id) ?? 0) + 1)
        }
      }
    }

    const minCount  = Math.max(GLOBAL_THRESHOLD_MIN, Math.ceil(totalNodes * GLOBAL_THRESHOLD_RATIO))
    const globalIds = new Set<string>()
    for (const [id, count] of freq) {
      if (count >= minCount) globalIds.add(id)
    }

    if (globalIds.size === 0) return

    // Populate registry and split per-node elements
    for (const node of allNodes) {
      const ownElements: CapturedElement[]   = []
      const inheritedIds: string[] = []
      for (const el of node.elements ?? []) {
        if (globalIds.has(el.id)) {
          inheritedIds.push(el.id)
          if (!this.globalElements.has(el.id)) this.globalElements.set(el.id, el)
        } else {
          ownElements.push(el)
        }
      }
      node.ownElements         = ownElements
      node.inheritedElementIds = inheritedIds
      // node.elements stays as the full merged runtime set
    }

    console.log(`[GRAPH] Promoted ${this.globalElements.size} element(s) to globalElements (threshold: ≥${minCount}/${totalNodes} nodes)`)
  }

  toJSON(): Graph {
    // Serialize nodes using ownElements + inheritedElementIds (not full elements)
    // so that globalElements are not duplicated per node in the output file.
    const serializedNodes: Record<string, Node> = {}
    for (const [id, node] of this.nodes) {
      const { elements: _elements, ...rest } = node  // eslint-disable-line @typescript-eslint/no-unused-vars
      // Resolve the full element list: inherited globals + own elements
      const inheritedIds = node.inheritedElementIds ?? []
      const inheritedElements = inheritedIds
        .map(eid => this.globalElements.get(eid))
        .filter((e): e is CapturedElement => e !== undefined)
      const ownEls = node.ownElements ?? node.elements ?? []

      serializedNodes[id] = {
        ...rest,
        elements:            [...inheritedElements, ...ownEls],
        ownElements:         ownEls,
        inheritedElementIds: inheritedIds,
      }
    }

    const globalElementsObj = this.globalElements.size > 0
      ? Object.fromEntries(this.globalElements)
      : undefined

    return {
      globalElements: globalElementsObj,
      meta: {
        crawledAt:      new Date().toISOString(),
        seedUrl:        this.seedUrl,
        appId:          this.appId,
        uiLibrary:      this.dominantLibrary(),
        totalNodes:     this.nodes.size,
        totalEdges:     this.edges.length,
        unfilledFields: this.unfilledCount,
        cacheHitCount:  this._cacheHitCount,
        summary:               this._summary,
        source:                'flow-crawler',
        totalPredictedRoutes:  this._totalPredictedRoutes || undefined,
        confirmedPredictions:  this._confirmedPredictions || undefined,
        crawlErrors:           this._crawlErrors || undefined,
        annotatedAt:           this._annotatedAt,
        eval:                  this._eval,
        llmUsage:              this._llmUsage,
      },
      nodes: serializedNodes,
      edges: this.edges,
    }
  }

  /** Merge nodes whose distinctive elements are similar (Jaccard) AND whose outgoing-edge
   *  trigger sets overlap sufficiently. Handles two cases:
   *    1. Same page reachable via two different URLs (fingerprint identical → Jaccard = 1.0)
   *    2. Same page captured with slightly different element counts across runs or auth states
   *  Called before writeToFile so the output graph has no duplicate page nodes. */
  consolidateDuplicates(): void {
    const allNodes = [...this.nodes.values()]
    const totalNodes = allNodes.length

    // Build selector frequency map: how many nodes contain each selector.
    // Selectors appearing on >40% of pages are structural boilerplate (nav/header/footer)
    // and should not influence page-identity comparisons.
    const selectorFreq = new Map<string, number>()
    for (const node of allNodes) {
      const seen = new Set<string>()
      for (const el of node.elements ?? []) {
        if (el._selector && !seen.has(el._selector)) {
          seen.add(el._selector)
          selectorFreq.set(el._selector, (selectorFreq.get(el._selector) ?? 0) + 1)
        }
      }
    }
    const BOILERPLATE_THRESHOLD = Math.max(2, totalNodes * 0.4)
    const isBoilerplate = (sel: string) => (selectorFreq.get(sel) ?? 0) >= BOILERPLATE_THRESHOLD

    // Distinctive selector set for a node: exclude high-frequency boilerplate
    const distinctiveSelectors = (node: Node): Set<string> => {
      const result = new Set<string>()
      for (const el of node.elements ?? []) {
        if (el._selector && !isBoilerplate(el._selector)) result.add(el._selector)
      }
      return result
    }

    const jaccard = (a: Set<string>, b: Set<string>): number => {
      if (a.size === 0 && b.size === 0) return 1
      if (a.size === 0 || b.size === 0) return 0
      let intersection = 0
      for (const s of a) { if (b.has(s)) intersection++ }
      return intersection / (a.size + b.size - intersection)
    }

    // Outgoing trigger-element set for a node (element IDs of triggers, not destinations —
    // so two nodes pointing to slightly different pages can still match on triggers)
    const triggerSet = (id: string): Set<string> =>
      new Set(this.edges.filter(e => e.from === id).map(e => e.trigger.elementId ?? ''))

    const ids = [...this.nodes.keys()]
    const remap = new Map<string, string>()

    for (let i = 0; i < ids.length; i++) {
      const idA = ids[i]
      if (remap.has(idA)) continue   // already marked as a duplicate
      const nodeA = this.nodes.get(idA)!
      const selA  = distinctiveSelectors(nodeA)
      const trgA  = triggerSet(idA)

      for (let j = i + 1; j < ids.length; j++) {
        const idB = ids[j]
        if (remap.has(idB)) continue
        const nodeB = this.nodes.get(idB)!
        const selB  = distinctiveSelectors(nodeB)

        // Same normalizedUrl (hash preserved) = definitively the same page in a different
        // session/auth state. Always merge — no Jaccard check needed.
        // For different URLs, require strong structural similarity (0.8).
        const sameUrl = nodeA.normalizedUrl === nodeB.normalizedUrl
        if (!sameUrl) {
          // Both pages have no distinctive elements (pure nav pages) — don't merge
          if (selA.size === 0 && selB.size === 0) continue
          const elemSim = jaccard(selA, selB)
          if (elemSim < 0.8) continue
        }

        // Check that outgoing trigger sets are also compatible (one is subset of the other
        // or they overlap enough — the larger capture subsumes the smaller)
        const trgB    = triggerSet(idB)
        const trgSim  = trgA.size === 0 && trgB.size === 0
          ? 1
          : jaccard(trgA, trgB)

        if (sameUrl) {
          // Same-URL nodes on the same page are definitively duplicates — BUT wizard steps
          // share a normalizedUrl while being distinct states (e.g. before/after Accept).
          // Skip the merge if there is a direct edge between the two nodes (wizard step).
          const hasDirectEdge = this.edges.some(
            e => (e.from === idA && e.to === idB) || (e.from === idB && e.to === idA)
          )
          if (hasDirectEdge) continue
        } else if (trgSim < 0.5) {
          continue   // completely different navigation paths — not the same page
        }

        // Merge: canonical = node with more elements (richer capture wins); prefer visited over seeded
        const aIsSeeded = this.seededNodeIds.has(idA)
        const bIsSeeded = this.seededNodeIds.has(idB)
        let canonical = idA
        let duplicate = idB
        if (
          (!bIsSeeded && aIsSeeded) ||                                         // A is seeded-only, B is real
          (aIsSeeded === bIsSeeded && nodeB.elements.length > nodeA.elements.length)  // both same status, B is richer
        ) {
          canonical = idB
          duplicate = idA
        }
        remap.set(duplicate, canonical)
      }
    }

    if (remap.size === 0) return

    // Resolve transitive chains: A→B, B→C should collapse to A→C
    for (const [dup, canon] of remap) {
      let final = canon
      while (remap.has(final)) final = remap.get(final)!
      remap.set(dup, final)
    }

    // Merge elements: canonical node gets the union of elements from both nodes
    for (const [dup, canon] of remap) {
      const dupNode    = this.nodes.get(dup)
      const canonNode  = this.nodes.get(canon)
      if (!dupNode || !canonNode) continue
      const canonSelectors = new Set(canonNode.elements.map(e => e._selector))
      const extra = (dupNode.elements ?? []).filter(e => e._selector && !canonSelectors.has(e._selector))
      if (extra.length > 0) {
        this.nodes.set(canon, { ...canonNode, elements: [...canonNode.elements, ...extra] })
      }
    }

    // Rewrite edges
    for (const edge of this.edges) {
      if (remap.has(edge.from)) edge.from = remap.get(edge.from)!
      if (remap.has(edge.to))   edge.to   = remap.get(edge.to)!
    }

    // Deduplicate edges that became identical after remapping
    const seen = new Set<string>()
    this.edges = this.edges.filter(e => {
      const key = `${e.from}->${e.to}->${e.trigger.type}->${e.trigger.elementId ?? ''}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    // Remove duplicate nodes
    for (const dup of remap.keys()) {
      this.nodes.delete(dup)
      this.seededNodeIds.delete(dup)
    }

    const dupList = [...remap.entries()].map(([d, c]) => `${d}→${c}`).join(', ')
    console.log(`[GRAPH] Consolidated ${remap.size} duplicate node(s): ${dupList}`)
  }

  async writeToFile(filePath: string): Promise<void> {
    this.consolidateDuplicates()
    this.extractGlobalElements()
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(this.toJSON(), null, 2), 'utf8')
  }
}

export { normalizeUrl, nodeId, edgeId, pageFingerprint } from './urlNormalizer.js'
