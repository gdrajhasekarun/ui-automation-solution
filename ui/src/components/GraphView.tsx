import React, { useMemo } from 'react'
import { Table, Tooltip as AntTooltip } from 'antd'
import { useTheme } from '../theme'

// ── Types ─────────────────────────────────────────────────────────────────────
interface GraphElement {
  role: string
  name: string
  selectorKey: string
  actionType: string
}

interface GraphNode {
  nodeId: string
  url: string
  title: string
  elements: GraphElement[]
  assertableElements?: string[]
  className?: string
}

interface GraphData {
  nodes: GraphNode[]
  edges: { edgeId: string; fromNodeId: string; toNodeId: string; selectorKey?: string | null; label?: string; actionType?: string }[]
  meta?: { totalNodes?: number; totalEdges?: number; appId?: string; crawledAt?: string }
}

// ── Colour helpers ────────────────────────────────────────────────────────────
const ACTION_COLOR: Record<string, string> = {
  fill:   '#7dd3fc',
  select: '#86efac',
  click:  '#fbbf24',
  check:  '#c4b5fd',
}
function actionColor(a: string) { return ACTION_COLOR[a] ?? '#8B949E' }

function elementCountColor(count: number, C: ReturnType<typeof useTheme>['C']) {
  if (count === 0) return C.muted
  if (count <= 4)  return C.blue
  if (count <= 9)  return C.amber
  return C.green
}

// ── Main component ────────────────────────────────────────────────────────────
export default function GraphView({ data }: { data: GraphData }) {
  const { C } = useTheme()
  const nodes = data.nodes || []
  const meta = data.meta

  const rows = useMemo(() =>
    [...nodes]
      .sort((a, b) => (b.elements?.length ?? 0) - (a.elements?.length ?? 0))
      .map((n, i) => ({ ...n, key: n.nodeId, idx: i + 1 })),
    [nodes]
  )

  const tagStyle = (action: string): React.CSSProperties => ({
    fontFamily: "'IBM Plex Mono',monospace",
    fontSize: 10,
    color: actionColor(action),
    background: actionColor(action) + '22',
    border: `1px solid ${actionColor(action)}55`,
    borderRadius: 4,
    padding: '1px 6px',
    marginRight: 3,
    marginBottom: 2,
    display: 'inline-block',
  })

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
      title: 'POM File',
      dataIndex: 'className',
      width: 210,
      render: (cls: string) => (
        <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: cls ? C.green : C.muted }}>
          {cls ? cls + '.java' : '—'}
        </span>
      ),
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
        els.forEach(e => { counts[e.actionType] = (counts[e.actionType] ?? 0) + 1 })
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
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px 0' }}>
        {row.elements.map((el, i) => (
          <AntTooltip key={i} title={<span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11 }}>{el.selectorKey}</span>} color="#1a1a2e">
            <div style={{
              background: C.surface,
              border: `1px solid ${actionColor(el.actionType)}44`,
              borderRadius: 6,
              padding: '5px 10px',
              cursor: 'default',
              minWidth: 130,
            }}>
              <div style={{ fontSize: 10, color: actionColor(el.actionType), fontFamily: "'IBM Plex Mono',monospace", marginBottom: 1 }}>
                {el.actionType} · {el.role}
              </div>
              <div style={{ fontSize: 12, color: C.text, fontFamily: "'IBM Plex Mono',monospace", fontWeight: 500 }}>
                {el.name || el.selectorKey}
              </div>
            </div>
          </AntTooltip>
        ))}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
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
        {/* Action legend */}
        <div style={{ display: 'flex', gap: 12, marginLeft: 8 }}>
          {Object.entries(ACTION_COLOR).map(([action, color]) => (
            <span key={action} style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color }}>
              ● {action}
            </span>
          ))}
        </div>
      </div>

      {/* Summary stat chips */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { label: 'Total pages',    value: nodes.length },
          { label: 'With elements',  value: nodes.filter(n => (n.elements?.length ?? 0) > 0).length },
          { label: 'Total elements', value: nodes.reduce((s, n) => s + (n.elements?.length ?? 0), 0) },
          { label: 'Fill inputs',    value: nodes.reduce((s, n) => s + (n.elements?.filter(e => e.actionType === 'fill').length ?? 0), 0) },
          { label: 'Selects',        value: nodes.reduce((s, n) => s + (n.elements?.filter(e => e.actionType === 'select').length ?? 0), 0) },
          { label: 'Clickables',     value: nodes.reduce((s, n) => s + (n.elements?.filter(e => e.actionType === 'click').length ?? 0), 0) },
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

      {/* Pages table — fills remaining height, single scrollbar on table body */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <Table
          dataSource={rows}
          columns={columns}
          expandable={{ expandedRowRender, rowExpandable: () => true }}
          size="small"
          pagination={false}
          scroll={{ y: '100%' }}
          rowKey="nodeId"
          style={{ fontFamily: "'IBM Plex Mono',monospace", height: '100%' }}
        />
      </div>
    </div>
  )
}
