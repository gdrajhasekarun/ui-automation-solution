import React, { useEffect, useRef, useState } from 'react'
import {
  Badge, Button, ConfigProvider, Descriptions, Divider, Input, InputNumber,
  Layout, Select, Space, Switch, Tabs, Tag, Tooltip, theme as antTheme,
} from 'antd'
import {
  ApiOutlined, BulbFilled, BulbOutlined, CheckCircleOutlined,
  CloseCircleOutlined, DatabaseOutlined, NodeIndexOutlined,
  PlayCircleOutlined, RocketOutlined, SyncOutlined, ThunderboltOutlined,
} from '@ant-design/icons'
import { Link } from 'react-router-dom'
import { ThemeContext, DARK, LIGHT } from '../theme'
import { useAppDispatch, useAppSelector } from '../store'
import { setAppId, setAppUrl, setFrameworkDir, toggleTheme } from '../store/appSlice'
import TestDesignTab from '../components/TestDesignTab'
import ExecutionTab from '../components/ExecutionTab'
import GraphView from '../components/GraphView'
import {
  apiV2,
  useV2TriggerCrawlMutation,
  useV2GetJobStatusQuery,
  useV2GetCrawlHealthQuery,
  useV2GetGraphQuery,
} from './apiV2'
import type { UiEvent } from '../types'

const { Header, Content, Sider } = Layout
const MONO: React.CSSProperties = { fontFamily: "'IBM Plex Mono', monospace" }

const LEVEL_COLOR: Record<string, string> = {
  SUCCESS: '#3fb950', ERROR: '#f85149', WARN: '#d29922', INFO: '#58a6ff',
}

const ACTION_COLOR: Record<string, string> = {
  navigate: '#58a6ff',
  click:    '#fbbf24',
  fill:     '#7dd3fc',
  select:   '#86efac',
}
function actionColor(a: string) { return ACTION_COLOR[a] ?? '#8b949e' }

// Parse ELEMENT|actionType|selectorKey|label events emitted by crawler.py
function parseElementMsg(msg: string): { actionType: string; selector: string; label: string } | null {
  if (!msg.startsWith('ELEMENT|')) return null
  const [, actionType, selector, ...labelParts] = msg.split('|')
  return { actionType, selector, label: labelParts.join('|') }
}

function fmtLocalTime(ts: string): string {
  if (!ts) return ''
  try {
    return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  } catch {
    return ts.slice(11, 19)
  }
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { status: 'success' | 'error' | 'processing' | 'warning' | 'default'; text: string }> = {
    COMPLETE: { status: 'success',    text: 'Complete' },
    FAILED:   { status: 'error',      text: 'Failed'   },
    RUNNING:  { status: 'processing', text: 'Running'  },
    STARTED:  { status: 'processing', text: 'Starting' },
    UNKNOWN:  { status: 'default',    text: 'Unknown'  },
  }
  const s = map[status?.toUpperCase()] ?? { status: 'default' as const, text: status ?? '—' }
  return <Badge status={s.status} text={<span style={{ ...MONO, fontSize: 12 }}>{s.text}</span>} />
}

// ── Crawl tab — config + trigger + live log ───────────────────────────────────
function CrawlTab({ C, isDark }: { C: typeof DARK; isDark: boolean }) {
  const dispatch = useAppDispatch()
  const reduxAppId       = useAppSelector(s => s.app.appId)
  const reduxAppUrl      = useAppSelector(s => s.app.appUrl)
  const reduxFrameworkDir = useAppSelector(s => s.app.frameworkDir)

  const [appId,        setLocalAppId]        = useState(reduxAppId)
  const [appUrl,       setLocalAppUrl]        = useState(reduxAppUrl)
  const [frameworkDir, setLocalFrameworkDir]  = useState(reduxFrameworkDir)
  const [excelPath,    setExcelPath]          = useState('./shared/config/seed.xlsx')
  const [maxPages,     setMaxPages]     = useState(60)
  const [maxDepth,     setMaxDepth]     = useState(3)
  const [headless,     setHeadless]     = useState(true)
  const [targetFlows,  setTargetFlows]  = useState<string[]>([])

  const [crawlJobId, setCrawlJobId] = useState<string | null>(null)
  const [polling,    setPolling]    = useState(false)
  const [events,     setEvents]     = useState<UiEvent[]>([])
  const [crawlStatus, setCrawlStatus] = useState({
    phase: 'idle' as 'idle' | 'bfs' | 'flow_exec' | 'done',
    currentPage: '',
    currentFlow: '',
    currentStep: '',
    bfsProgress: '',
  })
  const sseRef = useRef<EventSource | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  const [triggerCrawl, { isLoading: triggering }] = useV2TriggerCrawlMutation()
  const { data: health, refetch: refetchHealth }   = useV2GetCrawlHealthQuery()

  const { data: jobStatus } = useV2GetJobStatusQuery(crawlJobId!, {
    skip: !crawlJobId || !polling, pollingInterval: 2000,
  })

  useEffect(() => {
    if (!jobStatus) return
    const s = jobStatus.status?.toUpperCase()
    if (s === 'COMPLETE' || s === 'FAILED') {
      setPolling(false)
      if (s === 'COMPLETE') {
        // Bust the cached graph so Knowledge Base tab shows the latest crawl timestamp
        dispatch(apiV2.util.invalidateTags(['V2Graph']))
      }
    }
  }, [jobStatus, dispatch])

  function updateCrawlStatus(ev: UiEvent) {
    const msg = ev.message ?? ''
    const stage = ev.stage ?? ''
    setCrawlStatus(prev => {
      const next = { ...prev }
      if (stage === 'BFS') {
        next.phase = 'bfs'
        const m = msg.match(/BFS visiting \((\d+)\/(\d+)\)/)
        if (m) next.bfsProgress = `${m[1]} / ${m[2]}`
        const n = msg.match(/Node: '(.+?)' —/)
        if (n) next.currentPage = n[1]
      } else if (stage === 'FLOW_EXEC') {
        if (msg.includes('Phase 2') || msg.includes('flows on')) next.phase = 'flow_exec'
        const n = msg.match(/flows on '(.+?)'/)
        if (n) { next.currentPage = n[1]; next.currentFlow = ''; next.currentStep = '' }
      } else if (stage === 'FLOW_STEP') {
        const f = msg.match(/^Executing flow: (.+)/)
        if (f) { next.currentFlow = f[1]; next.currentStep = '' }
        else if (msg.includes('new tab') || msg.includes('gate bypass') || msg.includes('Form in')) {
          next.currentStep = msg.slice(0, 60)
        }
      } else if (stage === 'GRAPH') {
        next.phase = 'done'
        next.currentStep = msg.slice(0, 60)
      }
      return next
    })
  }

  function connectSSE(aid: string) {
    sseRef.current?.close()
    const es = new EventSource(`/api/v2/events/${encodeURIComponent(aid)}/stream`)
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data) as UiEvent
        setEvents(prev => [ev, ...prev].slice(0, 500))
        updateCrawlStatus(ev)
      } catch { /* ignore */ }
    }
    sseRef.current = es
  }
  useEffect(() => () => { sseRef.current?.close() }, [])

  useEffect(() => {
    logRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [events.length])

  async function handleTrigger() {
    if (!appId.trim() || !appUrl.trim()) return
    // Sync to Redux so TestDesign/Execution tabs get the app context
    dispatch(setAppId(appId.trim()))
    dispatch(setAppUrl(appUrl.trim()))
    dispatch(setFrameworkDir(frameworkDir.trim()))
    setEvents([])
    setCrawlJobId(null)
    setCrawlStatus({ phase: 'idle', currentPage: '', currentFlow: '', currentStep: '', bfsProgress: '' })
    connectSSE(appId.trim())
    const resp = await triggerCrawl({
      app_id:        appId.trim(),
      app_url:       appUrl.trim(),
      excel_path:    excelPath.trim(),
      framework_dir: frameworkDir.trim(),
      max_pages:     maxPages,
      max_depth:     maxDepth,
      headless,
      target_flows:  targetFlows.length > 0 ? targetFlows : undefined,
    })
    if ('data' in resp && resp.data?.crawl_job_id) {
      setCrawlJobId(resp.data.crawl_job_id)
      setPolling(true)
    }
  }

  const isRunning = polling || triggering
  const jobDone   = jobStatus?.status === 'COMPLETE' || jobStatus?.status === 'FAILED'

  return (
    <Layout style={{ height: '100%', overflow: 'hidden', background: C.bg }}>
      {/* Left sider */}
      <Sider width={300} style={{
        background: C.surface, borderRight: `1px solid ${C.border}`,
        overflowY: 'auto', padding: '20px 16px',
      }}>
        <p style={{ ...MONO, fontSize: 11, color: C.muted, marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Crawl Configuration
        </p>

        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <div>
            <label style={{ ...MONO, fontSize: 11, color: C.muted }}>App ID</label>
            <Input value={appId} onChange={e => setLocalAppId(e.target.value)}
              placeholder="my-app" size="small"
              style={{ marginTop: 4, ...MONO, fontSize: 12 }} />
          </div>
          <div>
            <label style={{ ...MONO, fontSize: 11, color: C.muted }}>App URL</label>
            <Input value={appUrl} onChange={e => setLocalAppUrl(e.target.value)}
              placeholder="http://localhost:8080" size="small"
              style={{ marginTop: 4, ...MONO, fontSize: 12 }} />
          </div>
          <div>
            <label style={{ ...MONO, fontSize: 11, color: C.muted }}>Seed Excel Path</label>
            <Input value={excelPath} onChange={e => setExcelPath(e.target.value)}
              placeholder="./shared/config/seed.xlsx" size="small"
              style={{ marginTop: 4, ...MONO, fontSize: 12 }} />
          </div>
          <div>
            <label style={{ ...MONO, fontSize: 11, color: C.muted }}>Framework Directory</label>
            <Input value={frameworkDir} onChange={e => setLocalFrameworkDir(e.target.value)}
              placeholder="./shared/java" size="small"
              style={{ marginTop: 4, ...MONO, fontSize: 12 }} />
            <div style={{ ...MONO, fontSize: 10, color: C.muted, marginTop: 3 }}>
              POM files → {frameworkDir.trim() || './shared/java'}/src/main/java/pages/
            </div>
          </div>
          <div>
            <label style={{ ...MONO, fontSize: 11, color: C.muted }}>Target Flows / Tabs</label>
            <Select
              mode="tags"
              size="small"
              placeholder="e.g. Login, Member Portal, Claims"
              value={targetFlows}
              onChange={setTargetFlows}
              tokenSeparators={[',']}
              style={{ marginTop: 4, width: '100%', ...MONO, fontSize: 12 }}
            />
            <div style={{ ...MONO, fontSize: 10, color: C.muted, marginTop: 3 }}>
              Optional — type flow or tab names, press Enter or comma to add. Leave empty to discover all flows.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={{ ...MONO, fontSize: 11, color: C.muted }}>Max Pages</label>
              <InputNumber value={maxPages} onChange={v => setMaxPages(v ?? 60)}
                min={1} max={500} size="small"
                style={{ marginTop: 4, width: '100%', ...MONO, fontSize: 12 }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ ...MONO, fontSize: 11, color: C.muted }}>Max Depth</label>
              <InputNumber value={maxDepth} onChange={v => setMaxDepth(v ?? 3)}
                min={1} max={10} size="small"
                style={{ marginTop: 4, width: '100%', ...MONO, fontSize: 12 }} />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label style={{ ...MONO, fontSize: 11, color: C.muted }}>Headless browser</label>
            <Switch size="small" checked={headless} onChange={setHeadless} />
          </div>
          <Button type="primary" block size="middle"
            icon={isRunning ? <SyncOutlined spin /> : <PlayCircleOutlined />}
            loading={triggering} disabled={isRunning || !appId.trim() || !appUrl.trim()}
            onClick={handleTrigger}
            style={{ ...MONO, fontWeight: 600, marginTop: 4 }}>
            {isRunning ? 'Crawling…' : 'Start BFS Crawl'}
          </Button>
        </Space>

        {crawlJobId && (
          <>
            <Divider style={{ borderColor: C.border, margin: '20px 0 16px' }} />
            <p style={{ ...MONO, fontSize: 11, color: C.muted, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Job Status
            </p>
            <Descriptions column={1} size="small"
              labelStyle={{ ...MONO, fontSize: 11, color: C.muted }}
              contentStyle={{ ...MONO, fontSize: 11, color: C.text }}>
              <Descriptions.Item label="Job ID">{crawlJobId}</Descriptions.Item>
              <Descriptions.Item label="Status">
                <StatusBadge status={jobStatus?.status ?? 'STARTED'} />
              </Descriptions.Item>
              {jobDone && jobStatus?.totalNodes !== undefined && (
                <Descriptions.Item label="Nodes">
                  <span style={{ color: C.green }}>{String(jobStatus.totalNodes)}</span>
                </Descriptions.Item>
              )}
              {jobDone && jobStatus?.totalEdges !== undefined && (
                <Descriptions.Item label="Edges">
                  <span style={{ color: C.blue }}>{String(jobStatus.totalEdges)}</span>
                </Descriptions.Item>
              )}
              {jobStatus?.error && (
                <Descriptions.Item label="Error">
                  <span style={{ color: C.red }}>{jobStatus.error}</span>
                </Descriptions.Item>
              )}
            </Descriptions>
          </>
        )}

        <Divider style={{ borderColor: C.border, margin: '20px 0 16px' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <p style={{ ...MONO, fontSize: 11, color: C.muted, margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Service Health
          </p>
          <Button size="small" type="text" icon={<SyncOutlined />}
            onClick={() => refetchHealth()} style={{ color: C.muted }} />
        </div>
        {health ? (
          <Descriptions column={1} size="small"
            labelStyle={{ ...MONO, fontSize: 11, color: C.muted }}
            contentStyle={{ ...MONO, fontSize: 11 }}>
            <Descriptions.Item label="Status">
              <span style={{ color: ['idle','running'].includes(health.status ?? '') ? C.green : C.red }}>
                {health.status}
              </span>
            </Descriptions.Item>
            {health.engine && <Descriptions.Item label="Engine">{health.engine}</Descriptions.Item>}
            {health.port   && <Descriptions.Item label="Port">{String(health.port)}</Descriptions.Item>}
          </Descriptions>
        ) : (
          <span style={{ ...MONO, fontSize: 11, color: C.muted }}>checking…</span>
        )}
      </Sider>

      {/* Right — live log */}
      <Content style={{
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        background: C.bg, padding: 20,
      }}>
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden',
        }}>
          <div style={{
            padding: '10px 16px', borderBottom: `1px solid ${C.border}`,
            display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
          }}>
            <NodeIndexOutlined style={{ color: C.blue }} />
            <span style={{ ...MONO, fontSize: 12, fontWeight: 600, color: C.text }}>Live Log</span>
            {isRunning && <SyncOutlined spin style={{ color: C.blue }} />}
            {jobStatus?.status === 'COMPLETE' && <CheckCircleOutlined style={{ color: C.green }} />}
            {jobStatus?.status === 'FAILED'   && <CloseCircleOutlined style={{ color: C.red }}   />}
            <span style={{ ...MONO, fontSize: 11, color: C.muted, marginLeft: 'auto' }}>{events.length} events</span>
          </div>
          {/* Live status strip — shows current phase, page, flow in real time */}
          {crawlStatus.phase !== 'idle' && (
            <div style={{
              padding: '8px 16px', borderBottom: `1px solid ${C.border}`,
              background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
              display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '1px 8px', borderRadius: 10,
                  background: crawlStatus.phase === 'bfs' ? C.blue + '33'
                            : crawlStatus.phase === 'flow_exec' ? C.green + '33'
                            : crawlStatus.phase === 'done' ? C.muted + '33' : C.muted + '22',
                  color: crawlStatus.phase === 'bfs' ? C.blue
                       : crawlStatus.phase === 'flow_exec' ? C.green
                       : C.muted,
                  border: `1px solid ${crawlStatus.phase === 'bfs' ? C.blue : crawlStatus.phase === 'flow_exec' ? C.green : C.muted}44`,
                  ...MONO,
                }}>
                  {crawlStatus.phase === 'bfs' ? '● BFS' : crawlStatus.phase === 'flow_exec' ? '● FLOW EXEC' : '✓ DONE'}
                </span>
                {crawlStatus.currentPage && (
                  <span style={{ ...MONO, fontSize: 11, color: C.text }}>
                    <span style={{ color: C.muted }}>Page: </span>{crawlStatus.currentPage}
                  </span>
                )}
                {crawlStatus.bfsProgress && crawlStatus.phase === 'bfs' && (
                  <span style={{ ...MONO, fontSize: 11, color: C.muted, marginLeft: 'auto' }}>
                    {crawlStatus.bfsProgress} pages
                  </span>
                )}
              </div>
              {(crawlStatus.currentFlow || crawlStatus.currentStep) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingLeft: 2 }}>
                  {crawlStatus.currentFlow && (
                    <span style={{ ...MONO, fontSize: 11, color: C.text }}>
                      <span style={{ color: C.muted }}>Flow: </span>{crawlStatus.currentFlow}
                    </span>
                  )}
                  {crawlStatus.currentStep && (
                    <span style={{ ...MONO, fontSize: 10, color: C.muted }}>
                      — {crawlStatus.currentStep}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
          <div ref={logRef} style={{ flex: 1, overflowY: 'auto', padding: '8px 0', ...MONO, fontSize: 12 }}>
            {events.length === 0 ? (
              <div style={{ padding: '24px 16px', color: C.muted, textAlign: 'center', fontSize: 12 }}>
                {crawlJobId ? 'Waiting for events…' : 'Configure and start a crawl to see live output here.'}
              </div>
            ) : events.map((ev, i) => {
              const el = parseElementMsg(ev.message)
              if (el) {
                // Element row — indented chip style
                const ac = actionColor(el.actionType)
                return (
                  <div key={ev.event_id ?? ev.id ?? i} style={{
                    padding: '2px 16px 2px 40px',
                    borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)'}`,
                    display: 'flex', gap: 8, alignItems: 'center',
                  }}>
                    <span style={{
                      color: ac, background: ac + '22',
                      border: `1px solid ${ac}44`, borderRadius: 3,
                      fontSize: 10, padding: '1px 6px', whiteSpace: 'nowrap', flexShrink: 0,
                    }}>
                      {el.actionType}
                    </span>
                    <span style={{ color: C.text, fontSize: 11, ...MONO, flexShrink: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {el.selector}
                    </span>
                    {el.label && el.label !== el.selector && (
                      <span style={{ color: C.muted, fontSize: 11, flexShrink: 0 }}>— {el.label}</span>
                    )}
                  </div>
                )
              }
              // Standard event row
              return (
                <div key={ev.event_id ?? ev.id ?? i} style={{
                  padding: '3px 16px',
                  borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'}`,
                  display: 'flex', gap: 10, alignItems: 'flex-start',
                }}>
                  <span style={{ color: C.muted, fontSize: 10, whiteSpace: 'nowrap', paddingTop: 1, minWidth: 60 }}>
                    {fmtLocalTime(ev.created_at ?? ev.timestamp ?? '')}
                  </span>
                  <span style={{ color: LEVEL_COLOR[ev.level] ?? C.muted, fontSize: 10, whiteSpace: 'nowrap', minWidth: 52 }}>
                    {ev.level}
                  </span>
                  <span style={{ color: C.muted, fontSize: 10, whiteSpace: 'nowrap', minWidth: 110 }}>
                    {ev.stage}
                  </span>
                  <span style={{ color: C.text, fontSize: 12, lineHeight: 1.4 }}>{ev.message}</span>
                </div>
              )
            })}
          </div>
        </div>
      </Content>
    </Layout>
  )
}

// ── Knowledge Base tab — graph view with pages, classes, elements ─────────────
function KnowledgeBaseV2Tab({ C }: { C: typeof DARK }) {
  const appId = useAppSelector(s => s.app.appId)
  const { data: graph, isFetching, refetch } = useV2GetGraphQuery(appId, { skip: !appId })

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16,
        paddingBottom: 12, borderBottom: `1px solid ${C.border}`, flexShrink: 0,
      }}>
        <DatabaseOutlined style={{ color: C.blue, fontSize: 16 }} />
        <span style={{ ...MONO, fontSize: 14, fontWeight: 600, color: C.text }}>
          Knowledge Base
        </span>
        {appId && (
          <Tag style={{ ...MONO, fontSize: 11 }}>{appId}</Tag>
        )}
        {graph?.meta && (
          <>
            <Tag color="green"  style={{ ...MONO, fontSize: 11 }}>{graph.meta.totalNodes} pages</Tag>
            <Tag color="blue"   style={{ ...MONO, fontSize: 11 }}>{graph.meta.totalEdges} edges</Tag>
            {graph.meta?.crawledAt && (
              <span style={{ ...MONO, fontSize: 11, color: C.muted }}>
                crawled {new Date(graph.meta.crawledAt).toLocaleString()}
              </span>
            )}
          </>
        )}
        <div style={{ flex: 1 }} />
        <Button size="small" icon={<SyncOutlined spin={isFetching} />}
          onClick={() => refetch()} style={{ ...MONO, fontSize: 11 }}>
          Refresh
        </Button>
      </div>

      {/* Graph view fills remaining height */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {!appId ? (
          <div style={{ textAlign: 'center', padding: 48, color: C.muted, ...MONO, fontSize: 13 }}>
            Set an App ID in the Crawl AI tab and run a crawl first.
          </div>
        ) : !graph ? (
          <div style={{ textAlign: 'center', padding: 48, color: C.muted, ...MONO, fontSize: 13 }}>
            {isFetching ? 'Loading graph…' : 'No graph found — run a BFS crawl first.'}
          </div>
        ) : (
          <GraphView data={graph as unknown as Parameters<typeof GraphView>[0]['data']} />
        )}
      </div>
    </div>
  )
}

// ── Root AppV2 ────────────────────────────────────────────────────────────────
export default function AppV2() {
  const dispatch = useAppDispatch()
  const isDark   = useAppSelector(s => s.app.isDark)
  const C        = isDark ? DARK : LIGHT

  const [activeTab, setActiveTab] = useState('crawl')
  const { data: health } = useV2GetCrawlHealthQuery()

  const TAB_LABEL: React.CSSProperties = { ...MONO, fontSize: 13, fontWeight: 500, letterSpacing: '0.02em' }

  const tabItems = [
    {
      key: 'crawl',
      label: <span style={TAB_LABEL}><ThunderboltOutlined style={{ marginRight: 6 }} />Crawl AI</span>,
    },
    {
      key: 'kb',
      label: <span style={TAB_LABEL}><DatabaseOutlined style={{ marginRight: 6 }} />Knowledge Base</span>,
    },
    {
      key: 'td',
      label: <span style={TAB_LABEL}><RocketOutlined style={{ marginRight: 6 }} />Test Design</span>,
    },
    {
      key: 'ex',
      label: <span style={TAB_LABEL}><PlayCircleOutlined style={{ marginRight: 6 }} />Execution</span>,
    },
  ]

  return (
    <ThemeContext.Provider value={{ isDark, C, toggle: () => dispatch(toggleTheme()) }}>
      <ConfigProvider
        theme={{
          algorithm: isDark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
          token: {
            colorBgBase:          C.bg,
            colorBgContainer:     C.surface,
            colorBgLayout:        C.bg,
            colorBgElevated:      C.surface,
            colorBorder:          C.border,
            colorBorderSecondary: C.border,
            colorPrimary:         C.blue,
            colorSuccess:         C.green,
            colorWarning:         C.amber,
            colorError:           C.red,
            colorText:            C.text,
            colorTextSecondary:   C.muted,
            fontFamily:           "'IBM Plex Sans', sans-serif",
            fontFamilyCode:       "'IBM Plex Mono', monospace",
            borderRadius:         6,
          },
        }}
      >
        <Layout style={{ height: '100vh', overflow: 'hidden', background: C.bg }}>

          {/* Header */}
          <Header style={{
            background: C.surface, borderBottom: `1px solid ${C.border}`,
            display: 'flex', alignItems: 'center', padding: '0 24px',
            position: 'sticky', top: 0, zIndex: 100, height: 52, gap: 16,
          }}>
            <span style={{ ...MONO, fontSize: 13, fontWeight: 700, color: C.text, whiteSpace: 'nowrap' }}>
              AI Test Automation
            </span>
            <Tag color="blue" style={{ ...MONO, fontSize: 11, margin: 0 }}>V2 · BFS</Tag>

            {/* Tab bar */}
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <Tabs
                activeKey={activeTab}
                onChange={setActiveTab}
                items={tabItems}
                tabBarStyle={{ margin: 0, border: 'none' }}
                tabBarGutter={0}
                size="small"
                renderTabBar={(props, DefaultTabBar) => (
                  <DefaultTabBar {...props} style={{ margin: 0, border: 'none', background: 'transparent' }} />
                )}
              />
            </div>

            {/* Crawl-AI health pill */}
            <Tooltip title={`Crawl AI service: ${health?.status ?? 'checking…'}`}>
              <Space size={5} style={{ cursor: 'default', flexShrink: 0 }}>
                <ApiOutlined style={{
                  color: ['idle','running'].includes(health?.status ?? '') ? C.green : C.muted,
                  fontSize: 14,
                }} />
                <span style={{ ...MONO, fontSize: 11, color: C.muted }}>
                  {health?.status ?? '…'}
                </span>
              </Space>
            </Tooltip>

            <Divider type="vertical" style={{ borderColor: C.border, margin: '0 4px' }} />

            <Tooltip title="Switch to V3 (Graph Crawler)">
              <Link to="/v3" style={{ ...MONO, fontSize: 11, color: C.muted, flexShrink: 0 }}>V3 →</Link>
            </Tooltip>
            <Tooltip title="Switch to V1">
              <Link to="/" style={{ ...MONO, fontSize: 11, color: C.muted, flexShrink: 0 }}>← V1</Link>
            </Tooltip>

            <Tooltip title={isDark ? 'Light theme' : 'Dark theme'}>
              <Button type="text"
                icon={isDark
                  ? <BulbOutlined style={{ fontSize: 16 }} />
                  : <BulbFilled   style={{ fontSize: 16, color: C.amber }} />
                }
                onClick={() => dispatch(toggleTheme())}
                style={{ color: C.muted, flexShrink: 0 }}
              />
            </Tooltip>
          </Header>

          {/* Content */}
          <Content style={{
            height: 'calc(100vh - 52px)', overflow: 'hidden',
            display: 'flex', flexDirection: 'column',
          }}>
            {/* Crawl AI tab — sider layout */}
            <div style={{ display: activeTab === 'crawl' ? 'flex' : 'none', flex: 1, minHeight: 0, overflow: 'hidden' }}>
              <CrawlTab C={C} isDark={isDark} />
            </div>

            {/* Knowledge Base tab */}
            <div style={{ display: activeTab === 'kb' ? 'flex' : 'none', flex: 1, minHeight: 0, overflow: 'hidden', padding: 24, flexDirection: 'column' }}>
              <KnowledgeBaseV2Tab C={C} />
            </div>

            {/* Test Design tab — scrollable */}
            <div style={{ display: activeTab === 'td' ? 'block' : 'none', flex: 1, overflow: 'auto', padding: 24 }}>
              <TestDesignTab onGoToExecution={() => setActiveTab('ex')} />
            </div>

            {/* Execution tab — scrollable */}
            <div style={{ display: activeTab === 'ex' ? 'block' : 'none', flex: 1, overflow: 'auto', padding: 24 }}>
              <ExecutionTab />
            </div>
          </Content>
        </Layout>

        <style>{`
          body { background: ${C.bg}; margin: 0; }
          .ant-tabs-top > .ant-tabs-nav { margin-bottom: 0 !important; }
          .ant-tabs-top > .ant-tabs-nav::before { border-bottom: none !important; }
          .ant-tabs-tab { padding: 6px 16px !important; }
          .ant-tabs-tab-active .ant-tabs-tab-btn { color: ${C.text} !important; }
          .ant-tabs-ink-bar { background: ${C.blue} !important; height: 2px !important; }
          .ant-table-wrapper .ant-table { background: transparent !important; }
          .ant-table-wrapper .ant-table-thead > tr > th {
            background: ${C.surface} !important; color: ${C.muted} !important;
            font-family: 'IBM Plex Mono', monospace !important; font-size: 11px !important;
            text-transform: uppercase; letter-spacing: 0.04em;
          }
          .ant-table-wrapper .ant-table-tbody > tr > td { border-color: ${C.border} !important; }
          .ant-table-wrapper .ant-table-tbody > tr:hover > td {
            background: ${isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)'} !important;
          }
          .ant-table-wrapper { height: 100%; display: flex; flex-direction: column; }
          .ant-table-wrapper .ant-spin-nested-loading { flex: 1; min-height: 0; }
          .ant-table-wrapper .ant-spin-container { height: 100%; display: flex; flex-direction: column; }
          .ant-table-wrapper .ant-table { flex: 1; min-height: 0; }
          .ant-table-wrapper .ant-table-container { height: 100%; display: flex; flex-direction: column; }
          .ant-table-wrapper .ant-table-body { flex: 1; min-height: 0; overflow-y: auto !important; }
          ::-webkit-scrollbar { width: 6px; height: 6px; }
          ::-webkit-scrollbar-track { background: transparent; }
          ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }
          @keyframes kb-pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
          @keyframes exec-indeterminate { 0%{transform:translateX(-250%)} 100%{transform:translateX(600%)} }
          .exec-muted-row { opacity: 0.55; }
          .ant-drawer-close { color: ${C.muted} !important; }
        `}</style>
      </ConfigProvider>
    </ThemeContext.Provider>
  )
}
