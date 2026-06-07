import React, { useState, useEffect } from 'react'
import { Button, Input, Drawer, Spin } from 'antd'
import { UnorderedListOutlined, LoadingOutlined } from '@ant-design/icons'
import { useTheme } from '../theme'
import { useAppDispatch, useAppSelector } from '../store'
import { setAppId, setAppUrl, setFrameworkDir } from '../store/appSlice'
import { useTriggerCrawlMutation, useGetEventsQuery, useGetGraphQuery } from '../store/api'
import GraphView from './GraphView'
import type { UiEvent } from '../types'

// ── Types ─────────────────────────────────────────────────────────────────────
type StageStatus = 'not_started' | 'in_progress' | 'complete' | 'needs_review' | 'failed' | 'skipped'

interface SubStage { key: 'firecrawl' | 'playwright' | 'graph' | 'pom' | 'diff'; label: string }
interface StageDef  { name: string; substages: SubStage[] }

const STAGE_DEFS: StageDef[] = [
  { name: 'Page Crawl', substages: [
    { key: 'firecrawl',  label: 'Crawl4AI — page discovery' },
    { key: 'playwright', label: 'Playwright — interaction tracing' },
  ]},
  { name: 'Graph Build', substages: [
    { key: 'graph', label: 'Building nodes and edges · Writing graph.json' },
  ]},
  { name: 'POM Generation', substages: [
    { key: 'pom', label: 'Generating Java classes · Building POM registry' },
  ]},
]

const EVENT_STAGE_MAP: Record<string, SubStage['key']> = {
  CRAWL_C4AI: 'firecrawl', CRAWL_FC: 'firecrawl', CRAWL_PW: 'playwright',
  GRAPH: 'graph', GENERATOR: 'pom', DIFF: 'diff',
}

type StagesState = Record<SubStage['key'], { status: StageStatus; summary: string }>

const freshStages = (): StagesState => ({
  firecrawl:  { status: 'not_started', summary: '' },
  playwright: { status: 'not_started', summary: '' },
  graph:      { status: 'not_started', summary: '' },
  pom:        { status: 'not_started', summary: '' },
  diff:       { status: 'not_started', summary: '' },
})

// Pipeline order — a failure at any substage skips all substages after it
const PIPELINE_ORDER: SubStage['key'][] = ['firecrawl', 'playwright', 'graph', 'pom', 'diff']

function applySkips(state: StagesState): StagesState {
  let failing = false
  const next = { ...state }
  for (const key of PIPELINE_ORDER) {
    if (failing) {
      if (next[key].status === 'not_started') {
        next[key] = { ...next[key], status: 'skipped' }
      }
    } else if (next[key].status === 'failed') {
      failing = true
    }
  }
  return next
}

function aggregateStatus(keys: SubStage['key'][], stages: StagesState): StageStatus {
  const all = keys.map(k => stages[k])
  if (all.every(s => s.status === 'skipped'))       return 'skipped'
  if (all.every(s => s.status === 'complete' || s.status === 'skipped')) return 'complete'
  if (all.some(s  => s.status === 'failed'))        return 'failed'
  if (all.some(s  => s.status === 'needs_review'))  return 'needs_review'
  if (all.some(s  => s.status === 'in_progress'))   return 'in_progress'
  if (all.some(s  => s.status === 'skipped'))       return 'skipped'
  return 'not_started'
}

// ── Stage card ────────────────────────────────────────────────────────────────
function StageCard({ def, stages }: { def: StageDef; stages: StagesState }) {
  const { C } = useTheme()
  const agg = aggregateStatus(def.substages.map(s => s.key), stages)

  const colorMap: Record<StageStatus, string> = {
    not_started: C.border, in_progress: C.inProgress,
    complete: C.complete, needs_review: C.needsReview, failed: C.failed, skipped: C.muted,
  }
  const labelMap: Record<StageStatus, string> = {
    not_started: 'Not Started', in_progress: 'In Progress',
    complete: 'Complete', needs_review: 'Needs Review', failed: 'Failed', skipped: 'Skipped',
  }
  const color = colorMap[agg]
  const summary = def.substages.map(s => stages[s.key].summary).find(Boolean)

  return (
    <div style={{ flex: 1, background: C.surface2, border: `1px solid ${agg === 'in_progress' ? color + '88' : C.border}`, borderRadius: 8, padding: '16px 18px', minWidth: 180, transition: 'border-color 0.3s' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        {agg === 'in_progress'
          ? <Spin indicator={<LoadingOutlined style={{ fontSize: 12, color }} spin />} />
          : agg === 'skipped'
          ? <span style={{ width: 10, height: 2, background: C.muted, flexShrink: 0, borderRadius: 1, display: 'inline-block', marginBottom: 1 }} />
          : <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
        }
        <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, fontWeight: 600, color: C.text }}>{def.name}</span>
      </div>
      <div style={{
        display: 'inline-block', borderRadius: 12, padding: '2px 10px', marginBottom: 10,
        background: agg === 'not_started' ? 'transparent' : color + '22',
        border: `1px solid ${agg === 'not_started' ? C.border : color + '66'}`,
        fontFamily: "'IBM Plex Mono',monospace", fontSize: 11,
        color: agg === 'not_started' ? C.muted : color,
      }}>{labelMap[agg]}</div>
      {def.substages.map(sub => (
        <div key={sub.key} style={{ fontSize: 12, color: C.muted, marginBottom: 4, lineHeight: 1.4 }}>{sub.label}</div>
      ))}
      {summary && (
        <div style={{ marginTop: 8, fontSize: 12, fontFamily: "'IBM Plex Mono',monospace", borderTop: `1px solid ${C.border}`, paddingTop: 8, color: agg === 'needs_review' ? C.needsReview : C.muted }}>
          ↳ {summary}
        </div>
      )}
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function KnowledgeBaseTab() {
  const { C } = useTheme()
  const dispatch     = useAppDispatch()
  const appId        = useAppSelector(s => s.app.appId)
  const appUrl       = useAppSelector(s => s.app.appUrl)
  const frameworkDir = useAppSelector(s => s.app.frameworkDir)

  const [stages, setStages]         = useState<StagesState>(freshStages)
  const [seenIds]                   = useState(() => new Set<string>())
  const [logDrawerOpen, setLogOpen] = useState(false)
  const [polling, setPolling]       = useState(false)
  const [localError, setLocalError] = useState('')
  // Only process events emitted after the most recent trigger
  const triggerTimeRef              = React.useRef<number>(0)
  const [triggerSince, setTriggerSince] = useState('')

  const [triggerCrawl, { isLoading: triggering, error: triggerError }] = useTriggerCrawlMutation()

  // Load graph whenever pom stage completes (pipeline done)
  const graphReady = stages.pom.status === 'complete' || stages.pom.status === 'needs_review'
  const { data: graphData } = useGetGraphQuery(appId, { skip: !appId || !graphReady })

  // Poll events via RTK Query — polling active after trigger, every 2s
  const { data: events = [] } = useGetEventsQuery(
    { appId, limit: 200, since: triggerSince || undefined },
    { pollingInterval: polling ? 2000 : 0, skip: !appId }
  )

  // Derive stage state from the RTK Query event stream
  useEffect(() => {
    const cutoff = triggerTimeRef.current
    const newEvs = events.filter(ev => {
      const ts = ev.created_at ?? ev.timestamp ?? ''
      if (ts && new Date(ts).getTime() < cutoff) return false
      const id = ev.event_id ?? ev.id ?? (ts + ev.message)
      if (seenIds.has(id)) return false
      seenIds.add(id); return true
    })
    if (!newEvs.length) return

    setStages(prev => {
      let next = { ...prev }
      newEvs.forEach(ev => {
        const key = EVENT_STAGE_MAP[ev.stage]
        if (!key) return
        const s = { ...next[key] }
        const msg = (ev.message ?? '').toLowerCase()
        if (ev.level === 'ERROR') {
          s.status = 'failed'
        } else if (ev.level === 'SUCCESS' || msg.includes('complete') || msg.includes('done')) {
          s.status = msg.includes('removed') && msg.includes('review') ? 'needs_review' : 'complete'
          s.summary = ev.message ?? ''
        } else if (s.status === 'not_started') {
          s.status = 'in_progress'
        }
        next = { ...next, [key]: s }
      })
      return applySkips(next)
    })
  }, [events, seenIds])

  // Stop polling once the pipeline reaches a terminal state
  useEffect(() => {
    if (!polling) return
    const isTerminal = (s: { status: StageStatus }) =>
      s.status === 'complete' || s.status === 'needs_review' || s.status === 'failed' || s.status === 'skipped'
    if (
      isTerminal(stages.pom) ||
      (isTerminal(stages.firecrawl) && isTerminal(stages.playwright) && isTerminal(stages.graph))
    ) {
      setPolling(false)
    }
  }, [stages, polling])

  const buildKnowledgeBase = async () => {
    setLocalError('')
    if (!appId.trim())  { setLocalError('App ID is required.');  return }
    if (!appUrl.trim()) { setLocalError('App URL is required.'); return }
    seenIds.clear()
    setStages(freshStages())
    const sinceMs = Date.now() - 5000  // 5s grace for clock skew
    triggerTimeRef.current = sinceMs
    setTriggerSince(new Date(sinceMs).toISOString())
    setPolling(true)
    try {
      await triggerCrawl({
        app_id: appId.trim(), app_url: appUrl.trim(),
        build_id: 'build-' + Date.now(), trigger_type: 'INITIAL',
        framework_dir: frameworkDir.trim(),
      }).unwrap()
    } catch (e: unknown) {
      const msg = (e as { data?: { detail?: string }; error?: string })
      setLocalError(msg?.data?.detail ?? msg?.error ?? 'Trigger failed')
      setPolling(false)
    }
  }

  const displayError = localError || (triggerError ? JSON.stringify(triggerError) : '')

  const levelColor = (level: string) => {
    if (level === 'ERROR')   return C.red
    if (level === 'WARN')    return C.amber
    if (level === 'SUCCESS') return C.green
    return C.muted
  }
  const fmtTime = (ts?: string) => {
    if (!ts) return new Date().toTimeString().slice(0, 8)
    try { return new Date(ts).toTimeString().slice(0, 8) } catch { return ts.slice(11, 19) }
  }
  const labelStyle: React.CSSProperties = {
    fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: C.muted,
    textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4,
  }

  return (
    <div>


      {/* ── Inputs ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', marginBottom: 24 }}>
        <div>
          <div style={labelStyle}>App ID</div>
          <Input value={appId} onChange={e => dispatch(setAppId(e.target.value))} placeholder="sample-app" style={{ width: 180 }} />
        </div>
        <div>
          <div style={labelStyle}>App URL</div>
          <Input value={appUrl} onChange={e => dispatch(setAppUrl(e.target.value))} placeholder="https://your-app.com" style={{ width: 280 }} />
        </div>
        <div>
          <div style={labelStyle}>Framework Dir</div>
          <Input value={frameworkDir} onChange={e => dispatch(setFrameworkDir(e.target.value))} placeholder="./shared/java" style={{ width: 220 }} />
        </div>
        <Button
          type="primary"
          loading={triggering || polling}
          disabled={triggering || polling}
          onClick={buildKnowledgeBase}
          style={{ alignSelf: 'flex-end' }}
        >
          {polling ? 'Running…' : '▶ Build Knowledge Base'}
        </Button>
        <div style={{ flex: 1 }} />
        <Button icon={<UnorderedListOutlined />} onClick={() => setLogOpen(true)} style={{ alignSelf: 'flex-end' }}>
          Event Log{events.length > 0 ? ` (${events.length})` : ''}
        </Button>
      </div>

      {displayError && (
        <div style={{ color: C.red, fontSize: 12, fontFamily: "'IBM Plex Mono',monospace", marginBottom: 16 }}>{displayError}</div>
      )}

      {/* ── Pipeline stages ── */}
      <div>
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
          Pipeline Stages
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {STAGE_DEFS.map((def, i) => <StageCard key={i} def={def} stages={stages} />)}
        </div>
      </div>

      {/* ── Site Graph ── */}
      {graphData && (
        <div style={{ marginTop: 32 }}>
          <GraphView data={graphData as Parameters<typeof GraphView>[0]['data']} />
        </div>
      )}

      {/* ── Event Log Drawer ── */}
      <Drawer
        title={<span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 15, color: C.text }}>Live Event Log</span>}
        placement="right" width={560} open={logDrawerOpen} onClose={() => setLogOpen(false)}
        styles={{ header: { background: C.surface, borderBottom: `1px solid ${C.border}` }, body: { background: C.surface, padding: 0 }, mask: { background: 'rgba(0,0,0,0.5)' } }}
      >
        <div style={{ background: C.surface2, fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, height: '100%', overflowY: 'auto', padding: '12px 16px' }}>
          {events.length === 0
            ? <span style={{ color: C.muted }}>Waiting for events…</span>
            : (events as UiEvent[]).map((ev, i) => (
              <div key={i} style={{ marginBottom: 5, lineHeight: 1.6, color: levelColor(ev.level) }}>
                [{fmtTime(ev.created_at ?? ev.timestamp)}] [{ev.stage}] {ev.message}
              </div>
            ))
          }
        </div>
      </Drawer>
    </div>
  )
}
