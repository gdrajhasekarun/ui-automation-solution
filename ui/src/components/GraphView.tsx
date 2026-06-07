import React, { useCallback, useMemo } from 'react'
import {
  ReactFlow, Background, Controls, MiniMap,
  type Node, type Edge, type NodeProps,
  Handle, Position, useNodesState, useEdgesState,
  BackgroundVariant,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import dagre from 'dagre'
import { Tooltip } from 'antd'
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
}

interface GraphEdge {
  edgeId: string
  fromNodeId: string
  toNodeId: string
  label?: string
  actionType?: string
}

interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
  meta?: { totalNodes?: number; totalEdges?: number }
}

// ── Dagre layout ──────────────────────────────────────────────────────────────
const NODE_W = 160
const NODE_H = 48

function applyDagreLayout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 80, marginx: 20, marginy: 20 })
  nodes.forEach(n => g.setNode(n.id, { width: NODE_W, height: NODE_H }))
  edges.forEach(e => g.setEdge(e.source, e.target))
  dagre.layout(g)
  return nodes.map(n => {
    const pos = g.node(n.id)
    return { ...n, position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 } }
  })
}

// ── Custom node ───────────────────────────────────────────────────────────────
function PageNode({ data }: NodeProps) {
  const { C } = useTheme()
  const nodeData = data as { label: string; elements: GraphElement[]; url: string }
  const tooltipContent = (
    <div style={{ maxWidth: 320, fontFamily: "'IBM Plex Mono',monospace", fontSize: 11 }}>
      <div style={{ fontWeight: 700, marginBottom: 6, color: '#fff', fontSize: 12 }}>{nodeData.label}</div>
      <div style={{ color: '#aaa', marginBottom: 8, wordBreak: 'break-all', fontSize: 10 }}>{nodeData.url}</div>
      {nodeData.elements.length === 0
        ? <div style={{ color: '#888' }}>No interactable elements</div>
        : nodeData.elements.map((el, i) => (
          <div key={i} style={{ marginBottom: 4, borderBottom: '1px solid #333', paddingBottom: 4 }}>
            <span style={{ color: el.actionType === 'fill' ? '#7dd3fc' : el.actionType === 'select' ? '#86efac' : '#fbbf24' }}>
              {el.actionType}
            </span>
            <span style={{ color: '#ccc', marginLeft: 6 }}>{el.name || el.selectorKey}</span>
            <div style={{ color: '#666', fontSize: 10, marginTop: 1 }}>{el.selectorKey}</div>
          </div>
        ))
      }
    </div>
  )

  return (
    <Tooltip title={tooltipContent} placement="right" color="#1a1a2e" overlayStyle={{ maxWidth: 360 }}>
      <div style={{
        background: C.surface2,
        border: `1px solid ${nodeData.elements.length > 0 ? C.inProgress + '99' : C.border}`,
        borderRadius: 6,
        padding: '6px 12px',
        width: NODE_W,
        height: NODE_H,
        display: 'flex',
        alignItems: 'center',
        cursor: 'pointer',
        transition: 'border-color 0.2s, background 0.2s',
        overflow: 'hidden',
      }}>
        <Handle type="target" position={Position.Left} style={{ background: C.muted, width: 6, height: 6 }} />
        <div style={{ overflow: 'hidden' }}>
          <div style={{
            fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, fontWeight: 600,
            color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {nodeData.label}
          </div>
          <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>
            {nodeData.elements.length} element{nodeData.elements.length !== 1 ? 's' : ''}
          </div>
        </div>
        <Handle type="source" position={Position.Right} style={{ background: C.muted, width: 6, height: 6 }} />
      </div>
    </Tooltip>
  )
}

const nodeTypes = { page: PageNode }

// ── Main component ────────────────────────────────────────────────────────────
export default function GraphView({ data }: { data: GraphData }) {
  const { C } = useTheme()

  const { flowNodes, flowEdges } = useMemo(() => {
    const rawNodes: Node[] = (data.nodes || []).map(n => ({
      id: n.nodeId,
      type: 'page',
      position: { x: 0, y: 0 },
      data: { label: n.title || n.url, elements: n.elements || [], url: n.url },
    }))

    // Deduplicate edges — dagre crashes on parallel edges
    const seen = new Set<string>()
    const rawEdges: Edge[] = []
    ;(data.edges || []).forEach(e => {
      const key = `${e.fromNodeId}→${e.toNodeId}`
      if (seen.has(key) || e.fromNodeId === e.toNodeId) return
      seen.add(key)
      rawEdges.push({
        id: e.edgeId,
        source: e.fromNodeId,
        target: e.toNodeId,
        type: 'default',
        animated: false,
        style: { stroke: C.border, strokeWidth: 1 },
      })
    })

    const laid = applyDagreLayout(rawNodes, rawEdges)
    return { flowNodes: laid, flowEdges: rawEdges }
  }, [data, C.border])

  const [nodes, , onNodesChange] = useNodesState(flowNodes)
  const [edges, , onEdgesChange] = useEdgesState(flowEdges)

  const onInit = useCallback((instance: { fitView: () => void }) => {
    setTimeout(() => instance.fitView(), 50)
  }, [])

  const meta = data.meta
  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12,
        fontFamily: "'IBM Plex Mono',monospace",
      }}>
        <span style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Site Graph
        </span>
        {meta && (
          <>
            <span style={{ fontSize: 11, color: C.muted }}>
              {meta.totalNodes} pages · {meta.totalEdges} links
            </span>
          </>
        )}
        <span style={{ fontSize: 10, color: C.muted, marginLeft: 'auto' }}>
          Hover a node to see its elements
        </span>
      </div>
      <div style={{ height: 520, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', background: C.surface }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          onInit={onInit}
          fitView
          minZoom={0.1}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background color={C.border} variant={BackgroundVariant.Dots} gap={20} size={1} />
          <Controls style={{ background: C.surface2, border: `1px solid ${C.border}` }} />
          <MiniMap
            nodeColor={() => C.inProgress + '88'}
            maskColor={C.surface + 'cc'}
            style={{ background: C.surface2, border: `1px solid ${C.border}` }}
          />
        </ReactFlow>
      </div>
    </div>
  )
}
