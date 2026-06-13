import React, { useMemo } from 'react'
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
}

interface GraphNode {
  nodeId: string
  url: string
  title: string
  elements: GraphElement[]
  assertableElements?: string[]
  className?: string
  pageRef?: string  // always-present derived PascalCase name from backend normalization
}

interface GraphEdge {
  edgeId: string
  fromNodeId: string
  toNodeId: string
  selectorKey?: string | null
  label?: string
  actionType?: string
}

interface GraphData {
  nodes: GraphNode[] | Record<string, Omit<GraphNode, 'nodeId'>>
  edges: GraphEdge[]
  meta?: { totalNodes?: number; totalEdges?: number; appId?: string; crawledAt?: string }
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

// ── Main component ────────────────────────────────────────────────────────────
export default function GraphView({ data, fileExt = '.java' }: { data: GraphData; fileExt?: string }) {
  const { C, isDark } = useTheme()

  const rawNodes = data.nodes || []
  const nodes: GraphNode[] = Array.isArray(rawNodes)
    ? rawNodes
    : Object.entries(rawNodes as Record<string, Omit<GraphNode, 'nodeId'>>).map(
        ([nodeId, node]) => ({ nodeId, ...node })
      )
  const edges: GraphEdge[] = data.edges || []
  const meta = data.meta

  // Build lookup: nodeId → page title  (for edge hover)
  const nodeTitle = useMemo(() => {
    const m: Record<string, string> = {}
    nodes.forEach(n => { m[n.nodeId] = n.title || n.url || n.nodeId })
    return m
  }, [nodes])

  // Index edges by fromNodeId so we only show edges relevant to this node's elements
  const edgesByNode = useMemo(() => {
    const m: Record<string, GraphEdge[]> = {}
    edges.forEach(e => {
      if (!m[e.fromNodeId]) m[e.fromNodeId] = []
      m[e.fromNodeId].push(e)
    })
    return m
  }, [edges])

  const rows = useMemo(() =>
    [...nodes]
      .sort((a, b) => (b.elements?.length ?? 0) - (a.elements?.length ?? 0))
      .map((n, i) => ({ ...n, key: n.nodeId, idx: i + 1 })),
    [nodes]
  )

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

  const columns = [
    {
      title: '#',
      dataIndex: 'idx',
      width: 44,
      render: (v: number) => (
        <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: C.muted }}>{v}</span>
      ),
    },
    {
      title: 'Page',
      dataIndex: 'title',
      render: (_: string, row: GraphNode & { idx: number }) => (
        <div>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 2 }}>
            {row.title || '(untitled)'}
          </div>
          <AntTooltip title={row.url}>
            <div style={{ fontSize: 11, color: C.muted, maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {row.url}
            </div>
          </AntTooltip>
        </div>
      ),
    },
    {
      title: 'Page Ref',
      dataIndex: 'className',
      width: 230,
      render: (cls: string, row: GraphNode & { idx: number }) => {
        const ref = cls || derivePageRef(row)
        const generated = !!cls
        return (
          <span style={{
            fontFamily: "'IBM Plex Mono',monospace", fontSize: 11,
            color: generated ? C.green : C.muted,
          }}>
            {ref + fileExt}
            {!generated && (
              <span style={{ fontSize: 9, marginLeft: 5, color: C.amber, verticalAlign: 'middle' }}>derived</span>
            )}
          </span>
        )
      },
    },
    {
      title: 'Elements',
      dataIndex: 'elements',
      width: 90,
      render: (els: GraphElement[]) => (
        <span style={{
          fontFamily: "'IBM Plex Mono',monospace", fontSize: 14, fontWeight: 700,
          color: elementCountColor(els?.length ?? 0, C),
        }}>
          {els?.length ?? 0}
        </span>
      ),
      sorter: (a: GraphNode, b: GraphNode) => (a.elements?.length ?? 0) - (b.elements?.length ?? 0),
      defaultSortOrder: 'descend' as const,
    },
    {
      title: 'Action breakdown',
      dataIndex: 'elements',
      render: (els: GraphElement[]) => {
        if (!els?.length) return <span style={{ color: C.muted, fontSize: 11 }}>—</span>
        const counts: Record<string, number> = {}
        els.forEach(e => {
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

  const expandedRowRender = (row: GraphNode) => {
    if (!row.elements?.length) {
      return <span style={{ color: C.muted, fontSize: 12, fontFamily: "'IBM Plex Mono',monospace" }}>No interactable elements found on this page.</span>
    }

    const nodeEdges = edgesByNode[row.nodeId] || []

    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px 0', maxHeight: 280, overflowY: 'auto' }}>
        {row.elements.map((el, i) => {
          const actionType = resolveActionType(el)
          const color = actionColor(actionType, isDark)

          // Find target pages: check by element name and by selectorKey
          const elName = (el.name || el.label || '').trim()
          const elSelector = resolveSelector(el).trim()

          // Match edges from this node that correspond to this element
          const matchedEdges: GraphEdge[] = []
          nodeEdges.forEach(e => {
            const ek = (e.selectorKey || '').trim()
            if (ek && (ek === elName || ek === elSelector)) {
              matchedEdges.push(e)
            }
          })
          // Fallback: match by element name across all edges
          if (matchedEdges.length === 0 && elName) {
            edges.forEach(e => {
              const ek = (e.selectorKey || '').trim()
              if (ek === elName) matchedEdges.push(e)
            })
          }

          const tooltipContent = (
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, minWidth: 220 }}>
              <div style={{ color: '#aaa', marginBottom: matchedEdges.length ? 8 : 0 }}>
                {elSelector || '(no selector)'}
              </div>
              {matchedEdges.map((e, ei) => (
                <div key={ei} style={{
                  borderTop: '1px solid #2a2a3e', paddingTop: 6, marginTop: ei === 0 ? 0 : 4,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <span style={{
                      fontSize: 9, padding: '1px 5px', borderRadius: 3,
                      background: '#38bdf833', color: '#38bdf8',
                      border: '1px solid #38bdf855',
                    }}>
                      {e.actionType || e.label || 'navigate'}
                    </span>
                    {e.label && e.label !== e.actionType && (
                      <span style={{ color: '#666', fontSize: 9 }}>{e.label}</span>
                    )}
                  </div>
                  <div style={{ color: '#38bdf8' }}>
                    → {nodeTitle[e.toNodeId] || e.toNodeId}
                  </div>
                  {nodeTitle[e.toNodeId] && (
                    <div style={{ color: '#555', fontSize: 10, marginTop: 1 }}>{e.toNodeId}</div>
                  )}
                </div>
              ))}
            </div>
          )

          return (
            <AntTooltip key={i} title={tooltipContent} color={isDark ? '#1a1a2e' : '#1e293b'}>
              <div style={{
                background: C.surface,
                border: `1px solid ${color}44`,
                borderRadius: 6,
                padding: '5px 10px',
                cursor: 'default',
                minWidth: 130,
                position: 'relative',
              }}>
                <div style={{ fontSize: 10, color, fontFamily: "'IBM Plex Mono',monospace", marginBottom: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
                  {actionType}
                  {matchedEdges.length > 0 && (
                    <span style={{ color: isDark ? '#38bdf8' : '#0284c7', fontSize: 9 }}>↗</span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: C.text, fontFamily: "'IBM Plex Mono',monospace", fontWeight: 500 }}>
                  {el.name || el.label || resolveSelector(el)}
                </div>
              </div>
            </AntTooltip>
          )
        })}
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

      {/* Pages table — outer div scrolls, no scroll.y needed on Table */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <Table
          dataSource={rows}
          columns={columns}
          expandable={{ expandedRowRender, rowExpandable: () => true }}
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
