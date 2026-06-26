import React, { useMemo, useRef, useState } from 'react'
import { Table, Tooltip as AntTooltip } from 'antd'
import { useTheme } from '../theme'

// ── Types ─────────────────────────────────────────────────────────────────────
interface GraphElement {
  role: string
  name: string
  selectorKey?: string
  _selector?: string     // raw field name from app-graph-crawler / crawl-ai service (before normalization)
  actionType?: string
  elementType?: string   // raw type from graph crawler: link | button | select | textbox | combobox
  tag?: string
  inputType?: string
  label?: string
  placeholder?: string
  resolvedValue?: string // value filled from Excel/seed during crawl
  _resolvedValue?: string
  href?: string
}

interface GraphNode {
  nodeId: string
  url: string
  title: string
  elements: GraphElement[]
  ownElements?: GraphElement[]
  inheritedElementIds?: string[]
  assertableElements?: string[]
  className?: string
  pageRef?: string
  description?: string
  uiLibrary?: string
}

interface GraphEdge {
  edgeId?: string
  id?: string
  fromNodeId?: string
  toNodeId?: string
  from?: string     // flow-crawler format
  to?: string       // flow-crawler format
  trigger?: { elementName?: string; selectorKey?: string }
  selectorKey?: string | null
  label?: string
  actionType?: string
}

interface GraphData {
  nodes: GraphNode[] | Record<string, Omit<GraphNode, 'nodeId'>>
  edges: GraphEdge[]
  globalElements?: Record<string, GraphElement>
  meta?: {
    totalNodes?: number; totalEdges?: number; appId?: string; crawledAt?: string
    llmUsage?: {
      totalCalls: number; totalTokens: number; totalCostUsd: number
      calls: { fn: string; model: string; inputTokens: number; outputTokens: number; costUsd: number; ts: number }[]
    }
  }
}

// ── Selector resolution ───────────────────────────────────────────────────────
// Handles both normalized (selectorKey) and raw (_selector) formats.
function resolveSelector(el: GraphElement): string {
  return el.selectorKey || el._selector || ''
}

// ── Page ref name ────────────────────────────────────────────────────────────
// Mirrors pom_generator_v2._class_name_from_node — used as client-side fallback
// when the backend hasn't returned pageRef yet.
const _SKIP = new Set(['error page','access denied','page','untitled','403','404','500',''])
function toPascal(s: string): string {
  return s.replace(/[^a-zA-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean)
    .map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('')
}
function derivePageRef(node: GraphNode): string {
  // pageRef is set by the backend normalization — use it directly
  if (node.pageRef) return node.pageRef
  // Client-side fallback for any data that bypasses normalization
  const title = (node.title || '').trim()
  if (title && !_SKIP.has(title.toLowerCase())) return toPascal(title) + 'Page'
  try {
    const u = new URL(node.url || '')
    const parts = u.pathname.replace(/\.[^/]+$/, '').split('/').filter(p =>
      p && !['en-us','common','members','pages','aspx'].includes(p.toLowerCase()))
    const label = parts.slice(-2).join(' ')
    return label ? toPascal(label) + 'Page' : toPascal(u.hostname.split('.')[0]) + 'Page'
  } catch { return 'UnknownPage' }
}

// ── Action type resolution ─────────────────────────────────────────────────────
// Resolves the display action type from whichever fields are present.
// "link" is kept as its own type to distinguish navigation links from generic clicks.
function resolveActionType(el: GraphElement): string {
  // 1 — explicit actionType already set (crawl-ai format)
  if (el.actionType && el.actionType !== 'undefined') return el.actionType

  // 2 — raw elementType from app-graph-crawler
  const et = (el.elementType || '').toLowerCase()
  if (et === 'link')    return 'link'
  if (et === 'select')  return 'select'
  if (et === 'combobox') return 'select'
  if (et === 'textbox') return 'fill'
  if (et === 'button')  return 'click'

  // 3 — infer from role / tag / inputType
  const role = (el.role || '').toLowerCase()
  const tag  = (el.tag  || '').toLowerCase()
  const typ  = (el.inputType || '').toLowerCase()
  if (role === 'checkbox' || typ === 'checkbox')                  return 'check'
  if (role === 'combobox' || role === 'listbox' || tag === 'select') return 'select'
  if (
    role === 'textbox' || role === 'searchbox' || role === 'spinbutton' ||
    tag === 'textarea' ||
    ['text','email','password','search','tel','number','url'].includes(typ)
  ) return 'fill'
  if (tag === 'a' || role === 'link') return 'link'

  return 'click'
}

// ── Colour maps ────────────────────────────────────────────────────────────────
const ACTION_COLOR_DARK: Record<string, string> = {
  link:   '#38bdf8',
  fill:   '#7dd3fc',
  select: '#86efac',
  click:  '#fbbf24',
  check:  '#c4b5fd',
}
const ACTION_COLOR_LIGHT: Record<string, string> = {
  link:   '#0284c7',
  fill:   '#0369a1',
  select: '#166534',
  click:  '#92400e',
  check:  '#5b21b6',
}
function actionColor(a: string, isDark: boolean) {
  const map = isDark ? ACTION_COLOR_DARK : ACTION_COLOR_LIGHT
  return map[a] ?? (isDark ? '#8B949E' : '#374151')
}

function elementCountColor(count: number, C: ReturnType<typeof useTheme>['C']) {
  if (count === 0) return C.muted
  if (count <= 4)  return C.blue
  if (count <= 9)  return C.amber
  return C.green
}

// ── LLM Usage Panel ───────────────────────────────────────────────────────────
type LLMUsage = NonNullable<GraphData['meta']>['llmUsage']

function LLMUsagePanel({ usage, isDark }: { usage: NonNullable<LLMUsage>; isDark: boolean }) {
  const { C } = useTheme()
  const [expanded, setExpanded] = useState(false)

  const accent = isDark ? '#a78bfa' : '#7c3aed'

  return (
    <div style={{ marginBottom: 16, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}>
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px',
          background: C.surface2, cursor: 'pointer', userSelect: 'none',
        }}
      >
        <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, fontWeight: 700, color: accent, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          LLM Usage
        </span>
        <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: C.text }}>
          ${usage.totalCostUsd.toFixed(4)} · {usage.totalTokens.toLocaleString()} tokens · {usage.totalCalls} calls
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: C.muted }}>{expanded ? '▲' : '▼'}</span>
      </div>
      {expanded && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: "'IBM Plex Mono',monospace" }}>
            <thead>
              <tr style={{ background: C.surface2 }}>
                {['Function', 'Model', 'In tokens', 'Out tokens', 'Cost (USD)', 'Time'].map(h => (
                  <th key={h} style={{ padding: '6px 12px', textAlign: 'left', color: C.muted, fontWeight: 600, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {usage.calls.map((c, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: '5px 12px', color: accent }}>{c.fn}</td>
                  <td style={{ padding: '5px 12px', color: C.text }}>{c.model}</td>
                  <td style={{ padding: '5px 12px', color: C.muted, textAlign: 'right' }}>{c.inputTokens.toLocaleString()}</td>
                  <td style={{ padding: '5px 12px', color: C.muted, textAlign: 'right' }}>{c.outputTokens.toLocaleString()}</td>
                  <td style={{ padding: '5px 12px', color: C.text, textAlign: 'right' }}>${c.costUsd.toFixed(5)}</td>
                  <td style={{ padding: '5px 12px', color: C.muted }}>{new Date(c.ts).toLocaleTimeString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
const GLOBAL_TABS_KEY = '__global_tabs__'

export default function GraphView({ data, fileExt = '.java' }: { data: GraphData; fileExt?: string }) {
  const { C, isDark } = useTheme()
  const globalTabsRef = useRef<HTMLTableRowElement>(null)

  const rawNodes = data.nodes || []
  const nodes: GraphNode[] = Array.isArray(rawNodes)
    ? rawNodes
    : Object.entries(rawNodes as Record<string, Omit<GraphNode, 'nodeId'>>).map(
        ([nodeId, node]) => ({ nodeId, ...node })
      )
  const edges: GraphEdge[] = data.edges || []
  const globalElements = useMemo(() => data.globalElements || {}, [data.globalElements])
  const hasGlobalTabs = Object.keys(globalElements).length > 0
  const meta = data.meta

  // Build lookup: nodeId → page title  (for edge hover)
  const nodeTitle = useMemo(() => {
    const m: Record<string, string> = {}
    nodes.forEach(n => { m[n.nodeId] = n.title || n.url || n.nodeId })
    return m
  }, [nodes])

  // Normalize edge node IDs (support both fromNodeId/toNodeId and from/to formats)
  const edgeFrom = (e: GraphEdge) => e.fromNodeId || e.from || ''
  const edgeTo   = (e: GraphEdge) => e.toNodeId   || e.to   || ''
  const edgeSelectorKey = (e: GraphEdge) =>
    e.selectorKey || e.trigger?.selectorKey || e.trigger?.elementName || e.label || ''

  // Index edges by fromNodeId so we only show edges relevant to this node's elements
  const edgesByNode = useMemo(() => {
    const m: Record<string, GraphEdge[]> = {}
    edges.forEach(e => {
      const from = edgeFrom(e)
      if (!from) return
      if (!m[from]) m[from] = []
      m[from].push(e)
    })
    return m
  }, [edges])

  const rows = useMemo(() => {
    return [...nodes]
      .sort((a, b) => (b.elements?.length ?? 0) - (a.elements?.length ?? 0))
      .map((n, i) => ({ ...n, key: n.nodeId, idx: i + 1 }))
  }, [nodes])

  const [globalTabsExpanded, setGlobalTabsExpanded] = useState(true)

  const [expandedKeys, setExpandedKeys] = useState<string[]>([])
  const tableScrollRef = useRef<HTMLDivElement>(null)

  // Expand the row for targetNodeId and scroll it into view
  const jumpToNode = (targetNodeId: string) => {
    setExpandedKeys(prev => prev.includes(targetNodeId) ? prev : [...prev, targetNodeId])
    setTimeout(() => {
      const el = tableScrollRef.current?.querySelector(`[data-row-key="${targetNodeId}"]`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 80)
  }

  const tagStyle = (action: string): React.CSSProperties => {
    const c = actionColor(action, isDark)
    return {
      fontFamily: "'IBM Plex Mono',monospace",
      fontSize: 10,
      color: c,
      background: c + (isDark ? '22' : '18'),
      border: `1px solid ${c}${isDark ? '55' : '44'}`,
      borderRadius: 4,
      padding: '1px 6px',
      marginRight: 3,
      marginBottom: 2,
      display: 'inline-block',
    }
  }

  const scrollToGlobalTabs = () => {
    setGlobalTabsExpanded(true)
    setTimeout(() => {
      globalTabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 80)
  }

  const columns = [
    {
      title: '#',
      dataIndex: 'idx',
      width: 44,
      render: (v: number) => (
        <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: C.muted }}>{v || ''}</span>
      ),
    },
    {
      title: 'Page',
      dataIndex: 'title',
      render: (_: string, row: GraphNode & { idx: number }) => {
        return (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, fontWeight: 600, color: C.text }}>
                {row.title || '(untitled)'}
              </span>
              {row.uiLibrary && (
                <span style={{
                  fontFamily: "'IBM Plex Mono',monospace", fontSize: 9,
                  padding: '1px 5px', borderRadius: 3,
                  background: C.blue + '22', color: C.blue, border: `1px solid ${C.blue}44`,
                }}>
                  {row.uiLibrary}
                </span>
              )}
            </div>
            <AntTooltip title={row.url}>
              <div style={{ fontSize: 11, color: C.muted, maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: row.description ? 4 : 0 }}>
                {row.url}
              </div>
            </AntTooltip>
            {row.description && (
              <AntTooltip title={row.description}>
                <div style={{
                  fontSize: 11, color: C.muted, maxWidth: 400,
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                  overflow: 'hidden', lineHeight: 1.4, cursor: 'help',
                  fontStyle: 'italic',
                }}>
                  {row.description}
                </div>
              </AntTooltip>
            )}
          </div>
        )
      },
    },
    {
      title: 'Page Ref',
      dataIndex: 'className',
      width: 230,
      render: (cls: string, row: GraphNode & { idx: number }) => {
        const ref = cls || derivePageRef(row)
        const generated = !!cls
        return (
          <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: generated ? C.green : C.muted }}>
            {ref + fileExt}
            {!generated && <span style={{ fontSize: 9, marginLeft: 5, color: C.amber, verticalAlign: 'middle' }}>derived</span>}
          </span>
        )
      },
    },
    {
      title: 'Elements',
      dataIndex: 'elements',
      width: 120,
      render: (els: GraphElement[], row: GraphNode) => {
        const ownCount = row.ownElements ? row.ownElements.length : (els?.length ?? 0)
        const inheritedCount = row.inheritedElementIds?.length ?? 0
        return (
          <div style={{ fontFamily: "'IBM Plex Mono',monospace" }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: elementCountColor(ownCount, C) }}>{ownCount}</span>
            {inheritedCount > 0 && (
              <span style={{ fontSize: 10, color: C.muted, marginLeft: 4 }}>+{inheritedCount}</span>
            )}
          </div>
        )
      },
      sorter: (a: GraphNode, b: GraphNode) => (a.elements?.length ?? 0) - (b.elements?.length ?? 0),
      defaultSortOrder: 'descend' as const,
    },
    {
      title: 'Action breakdown',
      dataIndex: 'elements',
      render: (els: GraphElement[], row: GraphNode) => {
        const displayEls = row.ownElements ?? els
        if (!displayEls?.length) return <span style={{ color: C.muted, fontSize: 11 }}>—</span>
        const counts: Record<string, number> = {}
        displayEls.forEach(e => {
          const t = resolveActionType(e)
          counts[t] = (counts[t] ?? 0) + 1
        })
        return (
          <div style={{ display: 'flex', flexWrap: 'wrap' }}>
            {Object.entries(counts).map(([action, cnt]) => (
              <span key={action} style={tagStyle(action)}>{action} ×{cnt}</span>
            ))}
          </div>
        )
      },
    },
  ]

  const buildElRows = (elements: GraphElement[], nodeId: string) =>
    elements.map((el, i) => {
      const elName     = (el.name || el.label || '').trim()
      const elSelector = resolveSelector(el).trim()
      const nodeEdges  = nodeId ? (edgesByNode[nodeId] || []) : edges
      const matchedEdges: GraphEdge[] = []
      nodeEdges.forEach(e => {
        const ek = edgeSelectorKey(e).trim()
        if (ek && (ek === elName || ek === elSelector)) matchedEdges.push(e)
      })
      if (matchedEdges.length === 0 && elName) {
        edges.forEach(e => {
          const ek = edgeSelectorKey(e).trim()
          if (ek === elName) matchedEdges.push(e)
        })
      }
      return { key: i, el, elName, elSelector, actionType: resolveActionType(el), matchedEdges }
    })

  const expandedRowRender = (row: GraphNode) => {
    const displayElements = row.ownElements ?? row.elements ?? []
    const elRows = buildElRows(displayElements, row.nodeId)

    const MONO_SM: React.CSSProperties = { fontFamily: "'IBM Plex Mono',monospace", fontSize: 11 }
    const thStyle: React.CSSProperties = {
      ...MONO_SM, fontSize: 10, color: C.muted, fontWeight: 600,
      textTransform: 'uppercase', letterSpacing: '0.05em',
      padding: '5px 10px', borderBottom: `1px solid ${C.border}`,
      background: isDark ? '#161b22' : '#f3f4f6',
      whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 1,
    }
    const tdStyle: React.CSSProperties = {
      ...MONO_SM, padding: '6px 10px', borderBottom: `1px solid ${C.border}`, verticalAlign: 'top',
    }

    // Derive possible values for an element
    const getPossibleValues = (el: GraphElement): string[] => {
      const action = resolveActionType(el)
      if (action === 'select') {
        // name field for selects contains option texts space-separated by the crawler
        const raw = (el.name || el.label || '').trim()
        if (raw) return raw.split(/\s{2,}|\n/).flatMap(s => s.trim() ? [s.trim()] : [])
      }
      if (action === 'fill') {
        const vals: string[] = []
        if (el.placeholder) vals.push(`placeholder: ${el.placeholder}`)
        const rv = el.resolvedValue || el._resolvedValue
        if (rv) vals.push(`filled: ${rv}`)
        return vals
      }
      if (action === 'link') {
        const href = el.href
        if (href && href !== 'javascript:void(0)') return [href]
      }
      return []
    }

    const inheritedCount = row.inheritedElementIds?.length ?? 0

    return (
      <div style={{ padding: '4px 0 8px' }}>
        {row.description && (
          <div style={{
            ...MONO_SM, color: C.muted, fontStyle: 'italic', marginBottom: 12, lineHeight: 1.5,
            padding: '8px 12px', background: C.surface2,
            borderLeft: `3px solid ${C.blue}66`, borderRadius: '0 4px 4px 0',
          }}>
            {row.description}
          </div>
        )}

        {inheritedCount > 0 && (
          <button
            onClick={scrollToGlobalTabs}
            style={{
              background: C.green + '15', border: `1px solid ${C.green}44`,
              borderRadius: 5, padding: '4px 10px', marginBottom: 10,
              cursor: 'pointer', fontFamily: "'IBM Plex Mono',monospace", fontSize: 11,
              color: C.green, display: 'inline-flex', alignItems: 'center', gap: 5,
            }}
          >
            ↑ {inheritedCount} inherited from GlobalTabs
          </button>
        )}

        {!elRows.length ? (
          <span style={{ ...MONO_SM, color: C.muted }}>No interactable elements found on this page.</span>
        ) : (
          <div style={{ overflowY: 'auto', maxHeight: 340, border: `1px solid ${C.border}`, borderRadius: 6, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, width: 36, textAlign: 'center' }}>#</th>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Locator</th>
                  <th style={{ ...thStyle, width: 90 }}>Action</th>
                  <th style={thStyle}>Possible Values</th>
                  <th style={thStyle}>Target Page</th>
                </tr>
              </thead>
              <tbody>
                {elRows.map(({ key, el, elName, elSelector, actionType, matchedEdges }) => {
                  const color = actionColor(actionType, isDark)
                  const possibleValues = getPossibleValues(el)
                  return (
                    <tr key={key} style={{ background: key % 2 === 0 ? 'transparent' : (isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)') }}>
                      <td style={{ ...tdStyle, color: C.muted, fontSize: 10, textAlign: 'center' }}>{key + 1}</td>

                      {/* Name */}
                      <td style={{ ...tdStyle, color: C.text, fontWeight: 500, maxWidth: 180 }}>
                        {elName || <span style={{ color: C.muted }}>—</span>}
                      </td>

                      {/* Locator */}
                      <td style={{ ...tdStyle, maxWidth: 220 }}>
                        <AntTooltip title={elSelector || undefined}>
                          <code style={{
                            color: C.muted, display: 'block', fontSize: 10,
                            maxWidth: 210, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            cursor: elSelector ? 'help' : 'default',
                            background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                            borderRadius: 3, padding: '1px 5px',
                          }}>
                            {elSelector || '—'}
                          </code>
                        </AntTooltip>
                      </td>

                      {/* Action */}
                      <td style={tdStyle}>
                        <span style={{
                          fontSize: 10, padding: '2px 7px', borderRadius: 4, fontWeight: 600,
                          color, background: color + (isDark ? '22' : '18'),
                          border: `1px solid ${color}${isDark ? '55' : '44'}`,
                          fontFamily: "'IBM Plex Mono',monospace",
                        }}>
                          {actionType}
                        </span>
                      </td>

                      {/* Possible Values */}
                      <td style={{ ...tdStyle, maxWidth: 220 }}>
                        {possibleValues.length === 0 ? (
                          <span style={{ color: C.border }}>—</span>
                        ) : possibleValues.length === 1 ? (
                          <AntTooltip title={possibleValues[0]}>
                            <span style={{
                              color: C.muted, fontSize: 10, display: 'block',
                              maxWidth: 210, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              cursor: 'help',
                            }}>
                              {possibleValues[0]}
                            </span>
                          </AntTooltip>
                        ) : (
                          <AntTooltip title={<div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11 }}>{possibleValues.map((v, vi) => <div key={vi}>{v}</div>)}</div>}>
                            <div style={{ cursor: 'help' }}>
                              {possibleValues.slice(0, 3).map((v, vi) => (
                                <span key={vi} style={{
                                  display: 'inline-block', fontSize: 9, margin: '1px 2px',
                                  padding: '1px 5px', borderRadius: 3,
                                  background: C.surface2, color: C.muted,
                                  border: `1px solid ${C.border}`,
                                  maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                  verticalAlign: 'middle',
                                }}>
                                  {v}
                                </span>
                              ))}
                              {possibleValues.length > 3 && (
                                <span style={{ fontSize: 9, color: C.muted }}> +{possibleValues.length - 3}</span>
                              )}
                            </div>
                          </AntTooltip>
                        )}
                      </td>

                      {/* Target */}
                      <td style={{ ...tdStyle, maxWidth: 200 }}>
                        {matchedEdges.length === 0 ? (
                          <span style={{ color: C.border }}>—</span>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {matchedEdges.map((e, ei) => {
                              const toId = edgeTo(e)
                              return (
                              <button
                                key={ei}
                                onClick={() => jumpToNode(toId)}
                                title={toId}
                                style={{
                                  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                                  color: C.blue, fontFamily: "'IBM Plex Mono',monospace", fontSize: 11,
                                  display: 'block', textAlign: 'left',
                                  maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                  textDecoration: 'underline', textUnderlineOffset: 2,
                                }}
                              >
                                → {nodeTitle[toId] || toId}
                              </button>
                            )})}

                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap', flexShrink: 0 }}>
        <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Site Knowledge
        </span>
        {meta && (
          <span style={{ fontSize: 11, color: C.muted }}>
            {meta.totalNodes} pages · {meta.totalEdges} links
            {meta.crawledAt && (
              <span style={{ marginLeft: 8, fontSize: 10 }}>
                · crawled {new Date(meta.crawledAt).toLocaleString()}
              </span>
            )}
          </span>
        )}
        <div style={{ display: 'flex', gap: 12, marginLeft: 8 }}>
          {Object.keys(ACTION_COLOR_DARK).map(action => (
            <span key={action} style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: actionColor(action, isDark) }}>
              ● {action}
            </span>
          ))}
        </div>
      </div>

      {/* Summary stat chips */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', flexShrink: 0 }}>
        {[
          { label: 'Total pages',    value: nodes.length },
          { label: 'With elements',  value: nodes.filter(n => (n.elements?.length ?? 0) > 0).length },
          { label: 'Total elements', value: nodes.reduce((s, n) => s + (n.elements?.length ?? 0), 0) },
          { label: 'Links',          value: nodes.reduce((s, n) => s + (n.elements?.filter(e => resolveActionType(e) === 'link').length ?? 0), 0) },
          { label: 'Fill inputs',    value: nodes.reduce((s, n) => s + (n.elements?.filter(e => resolveActionType(e) === 'fill').length ?? 0), 0) },
          { label: 'Selects',        value: nodes.reduce((s, n) => s + (n.elements?.filter(e => resolveActionType(e) === 'select').length ?? 0), 0) },
          { label: 'Buttons',        value: nodes.reduce((s, n) => s + (n.elements?.filter(e => resolveActionType(e) === 'click').length ?? 0), 0) },
        ].map(({ label, value }) => (
          <div key={label} style={{
            background: C.surface2, border: `1px solid ${C.border}`,
            borderRadius: 6, padding: '6px 14px', textAlign: 'center',
          }}>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 16, fontWeight: 700, color: C.text }}>{value}</div>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: C.muted, marginTop: 1 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* LLM Usage section */}
      {meta?.llmUsage && <LLMUsagePanel usage={meta.llmUsage} isDark={isDark} />}

      {/* GlobalTabs section */}
      {hasGlobalTabs && (() => {
        const gtElements = Object.values(globalElements)
        const gtRows = buildElRows(gtElements, '')
        const MONO_SM: React.CSSProperties = { fontFamily: "'IBM Plex Mono',monospace", fontSize: 11 }
        const thStyle: React.CSSProperties = {
          ...MONO_SM, fontSize: 10, color: C.muted, fontWeight: 600,
          textTransform: 'uppercase' as const, letterSpacing: '0.05em',
          padding: '5px 10px', borderBottom: `1px solid ${C.border}`,
          background: isDark ? '#161b22' : '#f3f4f6',
          whiteSpace: 'nowrap' as const, position: 'sticky' as const, top: 0, zIndex: 1,
        }
        const tdStyle: React.CSSProperties = {
          ...MONO_SM, padding: '6px 10px', borderBottom: `1px solid ${C.border}`, verticalAlign: 'top' as const,
        }
        return (
          <div ref={globalTabsRef as React.Ref<HTMLDivElement>} style={{ marginBottom: 16, flexShrink: 0, border: `1px solid ${C.green}44`, borderRadius: 8, overflow: 'hidden' }}>
            {/* Header bar */}
            <button
              onClick={() => setGlobalTabsExpanded(e => !e)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 14px', background: C.green + '0f', border: 'none', cursor: 'pointer',
                borderBottom: globalTabsExpanded ? `1px solid ${C.green}33` : 'none',
              }}
            >
              <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, fontWeight: 700, color: C.green }}>GlobalTabs</span>
              <span style={{
                fontFamily: "'IBM Plex Mono',monospace", fontSize: 9, padding: '1px 6px', borderRadius: 3,
                background: C.green + '22', color: C.green, border: `1px solid ${C.green}44`,
              }}>Base Class</span>
              <span style={{ fontSize: 11, color: C.muted, fontStyle: 'italic' }}>Shared nav / tab elements inherited by all pages</span>
              <span style={{ marginLeft: 'auto', fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, fontWeight: 700, color: C.green }}>{gtElements.length}</span>
              <span style={{ color: C.muted, fontSize: 12, marginLeft: 6 }}>{globalTabsExpanded ? '▲' : '▼'}</span>
            </button>
            {globalTabsExpanded && (
              <div style={{ overflowX: 'auto', maxHeight: 300, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ ...thStyle, width: 36, textAlign: 'center' }}>#</th>
                      <th style={thStyle}>Name</th>
                      <th style={thStyle}>Locator</th>
                      <th style={{ ...thStyle, width: 90 }}>Action</th>
                      <th style={thStyle}>Possible Values</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gtRows.map(({ key, el, elName, elSelector, actionType }) => {
                      const color = actionColor(actionType, isDark)
                      return (
                        <tr key={key} style={{ background: key % 2 === 0 ? 'transparent' : (isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)') }}>
                          <td style={{ ...tdStyle, color: C.muted, fontSize: 10, textAlign: 'center' }}>{key + 1}</td>
                          <td style={{ ...tdStyle, color: C.text, fontWeight: 500, maxWidth: 180 }}>{elName || <span style={{ color: C.muted }}>—</span>}</td>
                          <td style={{ ...tdStyle, maxWidth: 220 }}>
                            <code style={{ color: C.muted, display: 'block', fontSize: 10, maxWidth: 210, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', borderRadius: 3, padding: '1px 5px' }}>
                              {elSelector || '—'}
                            </code>
                          </td>
                          <td style={tdStyle}>
                            <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, fontWeight: 600, color, background: color + (isDark ? '22' : '18'), border: `1px solid ${color}${isDark ? '55' : '44'}`, fontFamily: "'IBM Plex Mono',monospace" }}>
                              {actionType}
                            </span>
                          </td>
                          <td style={{ ...tdStyle, color: C.muted, fontSize: 10 }}>
                            {el.placeholder ? `placeholder: ${el.placeholder}` : (el.resolvedValue || el._resolvedValue || '—')}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })()}

      {/* Pages table — outer div scrolls, no scroll.y needed on Table */}
      <div ref={tableScrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <Table
          dataSource={rows}
          columns={columns}
          expandable={{
            expandedRowRender,
            rowExpandable: () => true,
            expandedRowKeys: expandedKeys,
            onExpandedRowsChange: keys => setExpandedKeys(keys as string[]),
          }}
          size="small"
          pagination={false}
          rowKey="nodeId"
          style={{ fontFamily: "'IBM Plex Mono',monospace" }}
          sticky
        />
      </div>
    </div>
  )
}
