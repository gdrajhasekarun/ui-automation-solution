import React, { useState, useEffect, useRef } from 'react'
import { Button, Input, Drawer, Spin, Slider, Tooltip } from 'antd'
import { UnorderedListOutlined, LoadingOutlined } from '@ant-design/icons'
import { useTheme } from '../theme'
import { useAppDispatch, useAppSelector } from '../store'
import { setAppId, setAppUrl, setFrameworkDir } from '../store/appSlice'
import { useTriggerCrawlMutation, useGetGraphQuery, useLazyGetEventsQuery } from '../store/api'
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

type StageEntry = { status: StageStatus; summary: string; startedAt: string; finishedAt: string }
type StagesState = Record<SubStage['key'], StageEntry>

const freshEntry = (): StageEntry => ({ status: 'not_started', summary: '', startedAt: '', finishedAt: '' })

const freshStages = (): StagesState => ({
  firecrawl:  freshEntry(),
  playwright: freshEntry(),
  graph:      freshEntry(),
  pom:        freshEntry(),
  diff:       freshEntry(),
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

  // Collect timestamps across all substages of this card
  const startedAt  = def.substages.map(s => stages[s.key].startedAt).filter(Boolean).sort()[0]  ?? ''
  const finishedAt = def.substages.map(s => stages[s.key].finishedAt).filter(Boolean).sort().at(-1) ?? ''

  const fmt = (ts: string) => {
    try { return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) }
    catch { return ts }
  }

  const duration = startedAt && finishedAt
    ? (() => {
        const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime()
        if (ms < 1000) return `${ms}ms`
        if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
        return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
      })()
    : ''

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
        {duration && (
          <span style={{ marginLeft: 'auto', fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: C.muted }}>
            {duration}
          </span>
        )}
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

      {/* Timestamps */}
      {startedAt && (
        <div style={{ marginTop: 8, fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: C.muted, lineHeight: 1.8 }}>
          {agg === 'in_progress'
            ? <span>▶ Started {fmt(startedAt)}</span>
            : <>
                <div>▶ {fmt(startedAt)}</div>
                {finishedAt && <div>■ {fmt(finishedAt)}</div>}
              </>
          }
        </div>
      )}

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

  const [stages, setStages]           = useState<StagesState>(freshStages)
  const [logDrawerOpen, setLogOpen]   = useState(false)
  const [running, setRunning]         = useState(false)
  const [localError, setLocalError]   = useState('')
  const [liveEvents, setLiveEvents]   = useState<UiEvent[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [filterThreshold, setFilterThreshold] = useState(35)   // percent, sent as 0–1 fraction

  const seenIdsRef   = useRef(new Set<string>())
  const esRef        = useRef<EventSource | null>(null)
  const replayingRef = useRef(false)
  const logBottomRef = useRef<HTMLDivElement | null>(null)

  const [triggerCrawl, { isLoading: triggering, error: triggerError }] = useTriggerCrawlMutation()
  const [fetchEvents] = useLazyGetEventsQuery()

  // Load graph whenever pom stage completes OR immediately if appId is set (graph.json may already exist on disk)
  const graphReady = !!appId.trim()
  const { data: graphData } = useGetGraphQuery(appId, { skip: !graphReady })

  // On appId change: fetch existing events and replay them to restore previous run state
  useEffect(() => {
    if (!appId.trim() || running) return
    seenIdsRef.current.clear()
    setStages(freshStages())
    setLiveEvents([])
    setHistoryLoading(true)
    replayingRef.current = true
    fetchEvents({ appId, limit: 500 }).then(result => {
      const events = result.data ?? []
      // API returns newest-first; replay oldest-first to reconstruct stage state correctly
      ;[...events].reverse().forEach(ev => applyEvent(ev))
      setHistoryLoading(false)
      replayingRef.current = false
    })
  // applyEvent is stable within a render cycle; running guards against re-fetching mid-run
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId])

  const isTerminal = (s: { status: StageStatus }) =>
    s.status === 'complete' || s.status === 'needs_review' || s.status === 'failed' || s.status === 'skipped'

  const applyEvent = (ev: UiEvent) => {
    const id = ev.event_id ?? ev.id ?? ((ev.created_at ?? ev.timestamp ?? '') + ev.message)
    if (seenIdsRef.current.has(id)) return
    seenIdsRef.current.add(id)

    setLiveEvents(prev => [...prev, ev])

    setStages(prev => {
      const key = EVENT_STAGE_MAP[ev.stage]
      if (!key) return prev
      const s = { ...prev[key] }
      const msg = (ev.message ?? '').toLowerCase()
      const ts = ev.created_at ?? ev.timestamp ?? new Date().toISOString()
      if (ev.level === 'ERROR') {
        s.status = 'failed'
        s.finishedAt = ts
      } else if (ev.level === 'SUCCESS') {
        s.status = msg.includes('removed') && msg.includes('review') ? 'needs_review' : 'complete'
        s.summary = ev.message ?? ''
        s.finishedAt = ts
      } else if (s.status === 'not_started') {
        s.status = 'in_progress'
        s.startedAt = ts
      }
      const next = applySkips({ ...prev, [key]: s })

      // Close SSE stream when pipeline reaches terminal state (skip during history replay)
      if (!replayingRef.current) {
        const anyFailed = next.firecrawl.status === 'failed' || next.playwright.status === 'failed' || next.graph.status === 'failed'
        if (isTerminal(next.pom) || anyFailed) {
          esRef.current?.close()
          esRef.current = null
          setRunning(false)
        }
      }
      return next
    })
  }

  // Open SSE connection after trigger
  const openStream = (since: string) => {
    esRef.current?.close()
    const url = `/dashboard/api/events/${encodeURIComponent(appId)}/stream?since=${encodeURIComponent(since)}`
    const es = new EventSource(url)
    esRef.current = es
    es.onmessage = (e) => {
      try { applyEvent(JSON.parse(e.data) as UiEvent) } catch { /* ignore malformed */ }
    }
    es.onerror = () => { /* EventSource auto-reconnects via Last-Event-ID */ }
  }

  // Close stream on unmount
  useEffect(() => () => { esRef.current?.close() }, [])

  // Auto-scroll event log to bottom whenever new events arrive
  useEffect(() => {
    if (logDrawerOpen) logBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [liveEvents, logDrawerOpen])

  const buildKnowledgeBase = async () => {
    setLocalError('')
    if (!appId.trim())  { setLocalError('App ID is required.');  return }
    if (!appUrl.trim()) { setLocalError('App URL is required.'); return }
    seenIdsRef.current.clear()
    setStages(freshStages())
    setLiveEvents([])
    const since = new Date(Date.now() - 5000).toISOString()  // 5s grace for clock skew
    setRunning(true)
    openStream(since)
    try {
      await triggerCrawl({
        app_id: appId.trim(), app_url: appUrl.trim(),
        build_id: 'build-' + Date.now(), trigger_type: 'INITIAL',
        framework_dir: frameworkDir.trim(),
        global_filter_threshold: filterThreshold / 100,
      }).unwrap()
    } catch (e: unknown) {
      const msg = (e as { data?: { detail?: string }; error?: string })
      setLocalError(msg?.data?.detail ?? msg?.error ?? 'Trigger failed')
      esRef.current?.close()
      esRef.current = null
      setRunning(false)
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>


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
        <div style={{ minWidth: 200, borderLeft: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}`, paddingLeft: 16, paddingRight: 16 }}>
          <Tooltip title="Elements appearing on this % of pages or more are treated as global nav/header/footer and removed from all POMs. Lower = stricter filtering.">
            <div style={labelStyle}>
              Global Filter Threshold — <span style={{ color: C.text }}>{filterThreshold}%</span>
            </div>
          </Tooltip>
          <Slider
            min={10} max={80} step={5}
            value={filterThreshold}
            onChange={setFilterThreshold}
            marks={{ 10: '10%', 35: '35%', 60: '60%', 80: '80%' }}
            style={{ width: 200 }}
            disabled={running}
          />
        </div>
        <Button
          type="primary"
          loading={triggering || running}
          disabled={triggering || running}
          onClick={buildKnowledgeBase}
          style={{ alignSelf: 'flex-end' }}
        >
          {running ? 'Running…' : '▶ Build Knowledge Base'}
        </Button>
        <div style={{ flex: 1 }} />
        {historyLoading && (
          <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: C.muted, alignSelf: 'flex-end', marginBottom: 6 }}>
            <Spin indicator={<LoadingOutlined style={{ fontSize: 11 }} spin />} style={{ marginRight: 6 }} />
            Loading previous run…
          </span>
        )}
        <Button icon={<UnorderedListOutlined />} onClick={() => setLogOpen(true)} style={{ alignSelf: 'flex-end' }}>
          Event Log{liveEvents.length > 0 ? ` (${liveEvents.length})` : ''}
        </Button>
      </div>

      {displayError && (
        <div style={{ color: C.red, fontSize: 12, fontFamily: "'IBM Plex Mono',monospace", marginBottom: 16 }}>{displayError}</div>
      )}

      {/* ── Pipeline stages ── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 12 }}>
          <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Pipeline Stages
          </span>
          {(() => {
            const allStarts = PIPELINE_ORDER.map(k => stages[k].startedAt).filter(Boolean).sort()
            const ts = allStarts[0]
            if (!ts) return null
            const d = new Date(ts)
            const label = d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
            return (
              <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: C.muted }}>
                · Last run <span style={{ color: C.text }}>{label}</span>
              </span>
            )
          })()}
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {STAGE_DEFS.map((def, i) => <StageCard key={i} def={def} stages={stages} />)}
        </div>
      </div>

      {/* ── Site Knowledge Table ── */}
      {graphData && (
        <div style={{ marginTop: 32, flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <GraphView data={graphData as Parameters<typeof GraphView>[0]['data']} />
        </div>
      )}

      {/* ── Event Log Drawer ── */}
      <Drawer
        title={
          <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 15, color: C.text }}>
            Event Log
            {liveEvents.length > 0 && (
              <span style={{ fontSize: 11, color: C.muted, marginLeft: 10 }}>
                {liveEvents.length} event{liveEvents.length !== 1 ? 's' : ''}
              </span>
            )}
          </span>
        }
        placement="right" width={600} open={logDrawerOpen} onClose={() => setLogOpen(false)}
        styles={{ header: { background: C.surface, borderBottom: `1px solid ${C.border}` }, body: { background: C.surface, padding: 0 }, mask: { background: 'rgba(0,0,0,0.5)' } }}
      >
        <div style={{ background: C.surface2, fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, height: '100%', overflowY: 'auto', padding: '12px 16px' }}>
          {liveEvents.length === 0
            ? <span style={{ color: C.muted }}>No events yet…</span>
            : [...liveEvents]
                .sort((a, b) => String(a.created_at ?? a.timestamp ?? '').localeCompare(String(b.created_at ?? b.timestamp ?? '')))
                .map((ev, i) => (
                  <div key={i} style={{ marginBottom: 4, lineHeight: 1.7, borderBottom: `1px solid ${C.border}22`, paddingBottom: 2 }}>
                    <span style={{ color: C.muted, marginRight: 8 }}>{fmtTime(ev.created_at ?? ev.timestamp)}</span>
                    <span style={{
                      display: 'inline-block', minWidth: 80, marginRight: 8,
                      color: ev.stage === 'CRAWL_C4AI' || ev.stage === 'CRAWL_PW' ? C.blue
                           : ev.stage === 'GRAPH' ? C.amber
                           : ev.stage === 'GENERATOR' ? C.green
                           : C.muted,
                    }}>[{ev.stage}]</span>
                    <span style={{ color: levelColor(ev.level) }}>{ev.message}</span>
                  </div>
                ))
          }
          <div ref={logBottomRef} />
        </div>
      </Drawer>
    </div>
  )
}
