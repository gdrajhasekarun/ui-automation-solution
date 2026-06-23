import React, { useEffect, useRef, useState } from 'react'
import {
  Badge, Button, Card, ConfigProvider, Descriptions, Divider, Input, InputNumber,
  Layout, Modal, Select, Space, Switch, Tabs, Tag, Tooltip, Typography, theme as antTheme,
} from 'antd'
import {
  ApiOutlined, BulbFilled, BulbOutlined, CheckCircleOutlined,
  CloseCircleOutlined, DatabaseOutlined, NodeIndexOutlined,
  PlayCircleOutlined, RocketOutlined, SyncOutlined, ThunderboltOutlined,
} from '@ant-design/icons'
import { ThemeContext, DARK, LIGHT } from '../theme'
import { useAppDispatch, useAppSelector } from '../store'
import { setAppId, setAppUrl, setFrameworkDir, setTargetTool, toggleTheme, bumpKbRefresh } from '../store/appSlice'
import type { TargetTool } from '../store/appSlice'
import TestDesignTab from '../components/TestDesignTab'
import ExecutionTab from '../components/ExecutionTab'
import GraphView from '../components/GraphView'
import {
  useV3TriggerCrawlMutation,
  useV3GetJobStatusQuery,
  useV3GetCrawlHealthQuery,
  useV3AiTriggerCrawlMutation,
  useV3AiGetJobStatusQuery,
  useV3AiGetCrawlHealthQuery,
  useV3AiGetGraphQuery,
  useInterpretStoryMutation,
} from './apiV3'
import type { UiEvent, StoryInterpretResp } from '../types'

const { Header, Content, Sider } = Layout
const MONO: React.CSSProperties = { fontFamily: "'IBM Plex Mono', monospace" }

const LEVEL_COLOR: Record<string, string> = {
  SUCCESS: '#3fb950', ERROR: '#f85149', WARNING: '#d29922', INFO: '#58a6ff',
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

// ── Crawl tab ─────────────────────────────────────────────────────────────────
function CrawlTab({ C, isDark }: { C: typeof DARK; isDark: boolean }) {
  const dispatch = useAppDispatch()
  const reduxAppId        = useAppSelector(s => s.app.appId)
  const reduxAppUrl       = useAppSelector(s => s.app.appUrl)
  const reduxFrameworkDir = useAppSelector(s => s.app.frameworkDir)
  const reduxTargetTool   = useAppSelector(s => s.app.targetTool)

  const [appId,         setLocalAppId]        = useState(reduxAppId)
  const [appUrl,        setLocalAppUrl]        = useState(reduxAppUrl)
  const [frameworkDir,  setLocalFrameworkDir]  = useState(reduxFrameworkDir)
  const [targetTool,    setLocalTargetTool]    = useState<TargetTool>(reduxTargetTool)
  const [excelPath,     setExcelPath]          = useState('./crawl-data.xlsx')
  const [allowedDomain, setAllowedDomain]      = useState('')
  const [configPath,    setConfigPath]         = useState('')
  const [targetFlows,   setTargetFlows]        = useState<string[]>([])
  const [maxPages,      setMaxPages]           = useState(60)
  const [maxDepth,      setMaxDepth]           = useState(3)
  const [headless,      setHeadless]           = useState(true)
  const [llmEnabled,    setLlmEnabled]         = useState(true)
  const [crawlerMode,   setCrawlerMode]        = useState<'graph' | 'ai'>('ai')

  // Flow suggestions derived from the previous AI crawl graph
  const { data: prevGraph } = useV3AiGetGraphQuery(appId, { skip: !appId })
  const flowSuggestions: string[] = React.useMemo(() => {
    if (!prevGraph?.nodes) return []
    const _SKIP = new Set(['home', 'page', 'index', 'untitled', 'error', '403', '404', '500', ''])
    const seen = new Set<string>()
    const suggestions: string[] = []
    for (const node of Object.values(prevGraph.nodes)) {
      const raw = (node.title || '').trim()
      // strip trailing " - App Name" suffixes
      const title = raw.replace(/\s*[-|]\s*.{1,40}$/, '').trim()
      if (!title || _SKIP.has(title.toLowerCase()) || title.length > 60) continue
      if (!seen.has(title)) {
        seen.add(title)
        suggestions.push(title)
      }
    }
    return suggestions.sort()
  }, [prevGraph])

  const [crawlJobId,  setCrawlJobId]  = useState<string | null>(null)
  const [polling,     setPolling]     = useState(false)
  const [events,      setEvents]      = useState<UiEvent[]>([])
  const [crawlPhase,  setCrawlPhase]  = useState<'idle' | 'bfs' | 'done'>('idle')
  const [currentPage, setCurrentPage] = useState('')
  const [bfsProgress, setBfsProgress] = useState('')
  const sseRef = useRef<EventSource | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  // Story mode state — persisted across stage navigation
  const [storyMode,         setStoryMode]         = useState<'story' | 'manual'>('story')
  const [storyDescription,  setStoryDescription]  = useState('')
  const [acceptanceCriteria,setAcceptanceCriteria] = useState('')
  const [storyStage,        setStoryStage]        = useState<'input' | 'intent'>('input')
  const [parsedIntent,      setParsedIntent]      = useState<StoryInterpretResp | null>(null)
  const [parsedFlowName,    setParsedFlowName]    = useState('')
  const [parsedSeedUrl,     setParsedSeedUrl]     = useState('')

  const [interpretStory,    { isLoading: isParsing }] = useInterpretStoryMutation()

  const [triggerGraphCrawl,  { isLoading: triggeringGraph }]  = useV3TriggerCrawlMutation()
  const [triggerAiCrawl,     { isLoading: triggeringAi }]     = useV3AiTriggerCrawlMutation()
  const { data: graphHealth } = useV3GetCrawlHealthQuery()
  const { data: aiHealth }    = useV3AiGetCrawlHealthQuery()
  const health   = crawlerMode === 'ai' ? aiHealth : graphHealth
  const triggering = crawlerMode === 'ai' ? triggeringAi : triggeringGraph

  const { data: graphJobStatus } = useV3GetJobStatusQuery(crawlJobId!, {
    skip: !crawlJobId || !polling || crawlerMode !== 'graph', pollingInterval: 2000,
  })
  const { data: aiJobStatus } = useV3AiGetJobStatusQuery(crawlJobId!, {
    skip: !crawlJobId || !polling || crawlerMode !== 'ai', pollingInterval: 2000,
  })
  const jobStatus = crawlerMode === 'ai' ? aiJobStatus : graphJobStatus

  useEffect(() => {
    if (!jobStatus) return
    const s = jobStatus.status?.toUpperCase()
    if (s === 'COMPLETE' || s === 'FAILED') {
      setPolling(false)
      if (s === 'COMPLETE') {
        dispatch(bumpKbRefresh())
      }
    }
  }, [jobStatus, dispatch, crawlerMode])

  function updateCrawlStatus(ev: UiEvent) {
    const msg   = ev.message ?? ''
    const stage = ev.stage ?? ''
    if (stage === 'BFS') {
      setCrawlPhase('bfs')
      const m = msg.match(/BFS complete/)
      if (m) setCrawlPhase('done')
      const n = msg.match(/Starting crawl \d+\/\d+ — account: (.+)/)
      if (n) setCurrentPage(n[1])
      const p = msg.match(/(\d+) nodes/)
      if (p) setBfsProgress(`${p[1]} nodes`)
    } else if (stage === 'GRAPH_CRAWLER') {
      if (msg.includes('complete')) setCrawlPhase('done')
    }
  }

  function connectSSE(aid: string, mode: 'graph' | 'ai') {
    sseRef.current?.close()
    const prefix = mode === 'ai' ? '/api/v3/ai' : '/api/v3'
    const es = new EventSource(`${prefix}/events/${encodeURIComponent(aid)}/stream`)
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data) as UiEvent
        setEvents(prev => [ev, ...prev].slice(0, 500))
        updateCrawlStatus(ev)
        // Bump KB refresh key after generator finishes so className annotations appear
        if (ev.stage === 'GENERATOR' && ev.level === 'SUCCESS') {
          dispatch(bumpKbRefresh())
        }
      } catch { /* ignore */ }
    }
    sseRef.current = es
  }
  useEffect(() => () => { sseRef.current?.close() }, [])

  useEffect(() => {
    logRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [events.length])

  async function runParse() {
    const combined = `Description:\n${storyDescription}\n\nAcceptance Criteria:\n${acceptanceCriteria}`
    const resp = await interpretStory({ user_story: combined, app_url: appUrl })
    if ('data' in resp && resp.data && !resp.data.error) {
      const data = resp.data
      setParsedIntent(data)
      setParsedFlowName(data.flow_name ?? '')
      setParsedSeedUrl(data.seed_url ?? appUrl)
      setStoryStage('intent')
    }
  }

  function handleGetIntent() {
    if (parsedIntent) {
      Modal.confirm({
        title: 'Re-parse story?',
        content: 'An intent has already been derived. Do you want to re-run the LLM parse and overwrite it?',
        okText: 'Yes, re-parse',
        cancelText: 'No, keep existing',
        onOk: () => { void runParse() },
        onCancel: () => setStoryStage('intent'),
      })
      return
    }
    void runParse()
  }

  function handleStartFromStory() {
    setTargetFlows([parsedFlowName])
    if (parsedSeedUrl) setLocalAppUrl(parsedSeedUrl)
    setCrawlerMode('ai')
    void handleTrigger()
  }

  async function handleTrigger() {
    if (!appId.trim() || !appUrl.trim()) return
    dispatch(setAppId(appId.trim()))
    dispatch(setAppUrl(appUrl.trim()))
    dispatch(setFrameworkDir(frameworkDir.trim()))
    dispatch(setTargetTool(targetTool))
    setEvents([])
    setCrawlJobId(null)
    setCrawlPhase('idle')
    setCurrentPage('')
    setBfsProgress('')
    connectSSE(appId.trim(), crawlerMode)

    let resp
    if (crawlerMode === 'ai') {
      resp = await triggerAiCrawl({
        app_id:         appId.trim(),
        app_url:        appUrl.trim(),
        excel_path:     excelPath.trim() || undefined,
        framework_dir:  frameworkDir.trim() || undefined,
        target_tool:    targetTool,
        max_pages:      maxPages,
        max_depth:      maxDepth,
        headless,
        llm_enabled:    llmEnabled,
        allowed_domain: allowedDomain.trim() || undefined,
        target_flows:   targetFlows.length > 0 ? targetFlows : undefined,
      })
    } else {
      resp = await triggerGraphCrawl({
        app_id:         appId.trim(),
        app_url:        appUrl.trim(),
        excel_path:     excelPath.trim() || undefined,
        framework_dir:  frameworkDir.trim() || undefined,
        target_tool:    targetTool,
        max_pages:      maxPages,
        headless,
        llm_enabled:    llmEnabled,
        allowed_domain: allowedDomain.trim() || undefined,
        config_path:    configPath.trim() || undefined,
        target_flows:   targetFlows.length > 0 ? targetFlows : undefined,
      })
    }
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
        {/* Mode toggle */}
        <div style={{ display: 'flex', marginBottom: 16, border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }}>
          {(['story', 'manual'] as const).map(mode => (
            <button key={mode} onClick={() => setStoryMode(mode)} style={{
              flex: 1, padding: '5px 0', cursor: 'pointer', border: 'none',
              background: storyMode === mode ? C.blue : 'transparent',
              color: storyMode === mode ? '#fff' : C.muted,
              ...MONO, fontSize: 11, fontWeight: storyMode === mode ? 600 : 400,
              textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>
              {mode === 'story' ? 'Story Mode' : 'Manual'}
            </button>
          ))}
        </div>

        {storyMode === 'story' ? (
          /* ── Story Mode ──────────────────────────────────────────── */
          storyStage === 'input' ? (
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
                <label style={{ ...MONO, fontSize: 11, color: C.muted }}>User Story Description</label>
                <Input.TextArea
                  rows={5} value={storyDescription}
                  onChange={e => setStoryDescription(e.target.value)}
                  placeholder={"As a [role], I want to [action] so that [outcome]..."}
                  style={{ marginTop: 4, ...MONO, fontSize: 12 }} />
              </div>
              <div>
                <label style={{ ...MONO, fontSize: 11, color: C.muted }}>Acceptance Criteria</label>
                <Input.TextArea
                  rows={5} value={acceptanceCriteria}
                  onChange={e => setAcceptanceCriteria(e.target.value)}
                  placeholder={"Given...\nWhen...\nThen..."}
                  style={{ marginTop: 4, ...MONO, fontSize: 12 }} />
              </div>
              <Button type="primary" block
                loading={isParsing}
                disabled={!storyDescription.trim() || !appUrl.trim() || !appId.trim()}
                onClick={handleGetIntent}
                style={{ ...MONO, fontWeight: 600 }}>
                Get Intent
              </Button>
            </Space>
          ) : (
            /* Stage 2 — intent confirmation */
            <Card
              size="small"
              title={<span style={{ ...MONO, fontSize: 12 }}>Parsed Intent</span>}
              extra={
                <Button size="small" type="text" style={{ ...MONO, fontSize: 11, color: C.muted }}
                  onClick={() => setStoryStage('input')}>
                  ← Edit Story
                </Button>
              }
              styles={{ body: { padding: '12px' } }}
              style={{ background: C.surface, borderColor: C.border }}
            >
              <Space direction="vertical" style={{ width: '100%' }} size={10}>
                <div>
                  <label style={{ ...MONO, fontSize: 11, color: C.muted }}>Flow Name</label>
                  <Input value={parsedFlowName} onChange={e => setParsedFlowName(e.target.value)}
                    size="small" style={{ marginTop: 4, ...MONO, fontSize: 12 }} />
                </div>
                {parsedIntent?.goal && (
                  <div>
                    <label style={{ ...MONO, fontSize: 11, color: C.muted }}>Goal</label>
                    <Typography.Text style={{ display: 'block', marginTop: 4, ...MONO, fontSize: 11, color: C.text }}>
                      {parsedIntent.goal}
                    </Typography.Text>
                  </div>
                )}
                {parsedIntent?.hints && parsedIntent.hints.length > 0 && (
                  <div>
                    <label style={{ ...MONO, fontSize: 11, color: C.muted }}>Hints</label>
                    <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {parsedIntent.hints.map(h => (
                        <Tag key={h.field} style={{ ...MONO, fontSize: 10 }}>
                          {h.field} = {h.field.toLowerCase().includes('password') ? '***' : h.value}
                        </Tag>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <label style={{ ...MONO, fontSize: 11, color: C.muted }}>Seed URL</label>
                  <Input value={parsedSeedUrl} onChange={e => setParsedSeedUrl(e.target.value)}
                    size="small" style={{ marginTop: 4, ...MONO, fontSize: 12 }} />
                </div>
                <Button type="primary" block
                  icon={isRunning ? <SyncOutlined spin /> : <PlayCircleOutlined />}
                  loading={triggering} disabled={isRunning || !parsedFlowName.trim()}
                  onClick={handleStartFromStory}
                  style={{ ...MONO, fontWeight: 600, marginTop: 4 }}>
                  {isRunning ? 'Crawling…' : 'Start Crawl →'}
                </Button>
              </Space>
            </Card>
          )
        ) : (
          /* ── Manual Config ───────────────────────────────────────── */
          <>
        <p style={{ ...MONO, fontSize: 11, color: C.muted, marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Crawl Configuration
        </p>

        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <div>
            <label style={{ ...MONO, fontSize: 11, color: C.muted }}>Crawler</label>
            <Select
              size="small" value={crawlerMode} onChange={setCrawlerMode}
              style={{ marginTop: 4, width: '100%', ...MONO, fontSize: 12 }}
              options={[
                { value: 'ai',    label: '🤖 AI Crawler (BFS + LLM flows)' },
                { value: 'graph', label: '⚡ Graph Crawler (fast BFS)' },
              ]}
            />
            <div style={{ ...MONO, fontSize: 10, color: C.muted, marginTop: 3 }}>
              {crawlerMode === 'ai'
                ? 'Runs BFS then AI-driven flow execution — slower but discovers more flows.'
                : 'Playwright BFS with static edge detection — fast, no LLM needed.'}
            </div>
          </div>
          <div>
            <label style={{ ...MONO, fontSize: 11, color: C.muted }}>App ID</label>
            <Input value={appId} onChange={e => setLocalAppId(e.target.value)}
              placeholder="my-app" size="small"
              style={{ marginTop: 4, ...MONO, fontSize: 12 }} />
          </div>
          <div>
            <label style={{ ...MONO, fontSize: 11, color: C.muted }}>Seed URL</label>
            <Input value={appUrl} onChange={e => setLocalAppUrl(e.target.value)}
              placeholder="http://localhost:8080" size="small"
              style={{ marginTop: 4, ...MONO, fontSize: 12 }} />
          </div>
          <div>
            <label style={{ ...MONO, fontSize: 11, color: C.muted }}>Excel Path (credentials + form fills)</label>
            <Input value={excelPath} onChange={e => setExcelPath(e.target.value)}
              placeholder="./crawl-data.xlsx" size="small"
              style={{ marginTop: 4, ...MONO, fontSize: 12 }} />
          </div>
          <div>
            <label style={{ ...MONO, fontSize: 11, color: C.muted }}>Target Flows / Sections</label>
            <Select
              mode="tags"
              size="small"
              placeholder="e.g. Login, Claims, Member Portal"
              value={targetFlows}
              onChange={setTargetFlows}
              tokenSeparators={[',']}
              options={flowSuggestions.map(s => ({ value: s, label: s }))}
              style={{ marginTop: 4, width: '100%', ...MONO, fontSize: 12 }}
            />
            <div style={{ ...MONO, fontSize: 10, color: C.muted, marginTop: 3 }}>
              {flowSuggestions.length > 0
                ? `${flowSuggestions.length} suggestions from last crawl — type to filter or add new.`
                : 'Optional — filters crawl to elements whose text matches these terms.'}
            </div>
          </div>
          <div>
            <label style={{ ...MONO, fontSize: 11, color: C.muted }}>Target Tool</label>
            <Select
              size="small" value={targetTool}
              onChange={(v: TargetTool) => setLocalTargetTool(v)}
              style={{ marginTop: 4, width: '100%', ...MONO, fontSize: 12 }}
              options={[
                { value: 'selenium-java',      label: '☕ Selenium Java' },
                { value: 'selenium-csharp',    label: '🔷 Selenium C#' },
                { value: 'selenium-python',    label: '🐍 Selenium Python' },
                { value: 'playwright-js',      label: '🎭 Playwright JS' },
                { value: 'playwright-ts',      label: '🎭 Playwright TypeScript' },
                { value: 'playwright-python',  label: '🐍 Playwright Python' },
                { value: 'cypress-js',         label: '🌲 Cypress JS' },
                { value: 'cypress-ts',         label: '🌲 Cypress TypeScript' },
              ]}
            />
            <div style={{ ...MONO, fontSize: 10, color: C.muted, marginTop: 3 }}>
              {targetTool === 'selenium-java'     && 'Generates Java Page Object Model classes'}
              {targetTool === 'selenium-csharp'   && 'Generates C# Page Object Model classes'}
              {targetTool === 'selenium-python'   && 'Generates Python Page Object Model classes (Selenium)'}
              {targetTool === 'playwright-js'     && 'Generates Playwright JS page classes'}
              {targetTool === 'playwright-ts'     && 'Generates Playwright TypeScript page classes'}
              {targetTool === 'playwright-python' && 'Generates Playwright Python page classes'}
              {targetTool === 'cypress-js'        && 'Generates Cypress JS page object classes'}
              {targetTool === 'cypress-ts'        && 'Generates Cypress TypeScript page object classes'}
            </div>
          </div>
          <div>
            <label style={{ ...MONO, fontSize: 11, color: C.muted }}>Framework Directory</label>
            <Input value={frameworkDir} onChange={e => setLocalFrameworkDir(e.target.value)}
              placeholder="./shared/java" size="small"
              style={{ marginTop: 4, ...MONO, fontSize: 12 }} />
            <div style={{ ...MONO, fontSize: 10, color: C.muted, marginTop: 3 }}>
              {targetTool === 'selenium-java'     && `POM files → ${frameworkDir.trim() || './framework'}/src/main/java/pages/`}
              {targetTool === 'selenium-csharp'   && `POM files → ${frameworkDir.trim() || './framework'}/src/Pages/`}
              {targetTool === 'selenium-python'   && `POM files → ${frameworkDir.trim() || './framework'}/pages/`}
              {(targetTool === 'playwright-js' || targetTool === 'playwright-ts') && `POM files → ${frameworkDir.trim() || './framework'}/src/pages/`}
              {targetTool === 'playwright-python' && `POM files → ${frameworkDir.trim() || './framework'}/pages/`}
              {(targetTool === 'cypress-js' || targetTool === 'cypress-ts') && `POM files → ${frameworkDir.trim() || './framework'}/cypress/pages/`}
            </div>
          </div>
          <div>
            <label style={{ ...MONO, fontSize: 11, color: C.muted }}>Max Pages</label>
            <InputNumber value={maxPages} onChange={v => setMaxPages(v ?? 60)}
              min={1} max={500} size="small"
              style={{ marginTop: 4, width: '100%', ...MONO, fontSize: 12 }} />
          </div>
          {crawlerMode === 'ai' && (
            <div>
              <label style={{ ...MONO, fontSize: 11, color: C.muted }}>Max Depth</label>
              <InputNumber value={maxDepth} onChange={v => setMaxDepth(v ?? 3)}
                min={1} max={10} size="small"
                style={{ marginTop: 4, width: '100%', ...MONO, fontSize: 12 }} />
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label style={{ ...MONO, fontSize: 11, color: C.muted }}>Headless browser</label>
            <Switch size="small" checked={headless} onChange={setHeadless} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label style={{ ...MONO, fontSize: 11, color: C.muted }}>LLM enrichment</label>
            <Switch size="small" checked={llmEnabled} onChange={setLlmEnabled} />
          </div>
          <Button type="primary" block size="middle"
            icon={isRunning ? <SyncOutlined spin /> : <PlayCircleOutlined />}
            loading={triggering} disabled={isRunning || !appId.trim() || !appUrl.trim()}
            onClick={handleTrigger}
            style={{ ...MONO, fontWeight: 600, marginTop: 4 }}>
            {isRunning ? 'Crawling…' : crawlerMode === 'ai' ? 'Start AI Crawl' : 'Start Graph Crawl'}
          </Button>
        </Space>
        </>
        )}

        {crawlJobId && (
          <>
            <Divider style={{ borderColor: C.border, margin: '20px 0 16px' }} />
            <p style={{ ...MONO, fontSize: 11, color: C.muted, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Job Status
            </p>
            <Descriptions column={1} size="small"
              labelStyle={{ ...MONO, fontSize: 11, color: C.muted }}
              contentStyle={{ ...MONO, fontSize: 11, color: C.text }}>
              <Descriptions.Item label="Job ID">
                <span style={{ fontSize: 10 }}>{crawlJobId}</span>
              </Descriptions.Item>
              <Descriptions.Item label="Status">
                <StatusBadge status={jobStatus?.status ?? 'STARTED'} />
              </Descriptions.Item>
              {jobDone && jobStatus?.node_count !== undefined && (
                <Descriptions.Item label="Nodes">
                  <span style={{ color: C.green }}>{String(jobStatus.node_count)}</span>
                </Descriptions.Item>
              )}
              {jobDone && jobStatus?.edge_count !== undefined && (
                <Descriptions.Item label="Edges">
                  <span style={{ color: C.blue }}>{String(jobStatus.edge_count)}</span>
                </Descriptions.Item>
              )}
              {jobDone && jobStatus?.unfilled_fields !== undefined && (
                <Descriptions.Item label="Unfilled">
                  <span style={{ color: C.amber }}>{String(jobStatus.unfilled_fields)}</span>
                </Descriptions.Item>
              )}
              {jobDone && jobStatus?.eval_score !== undefined && (
                <Descriptions.Item label="Eval">
                  <span style={{ color: jobStatus.eval_score >= 90 ? C.green : jobStatus.eval_score >= 70 ? C.amber : C.red, fontWeight: 600 }}>
                    {String(jobStatus.eval_score)}/100
                  </span>
                  {jobStatus.eval_grade && (
                    <span style={{ marginLeft: 6, color: C.muted }}>Grade {jobStatus.eval_grade}</span>
                  )}
                </Descriptions.Item>
              )}
              {jobDone && jobStatus?.spec_quality_recommendation && (
                <Descriptions.Item label="Spec Quality">
                  {(() => {
                    const rec = jobStatus.spec_quality_recommendation
                    const color = rec === 'ready' ? C.green : rec === 'review_required' ? C.amber : C.red
                    const label = rec === 'ready' ? 'Ready' : rec === 'review_required' ? 'Review required' : 'Recrawl recommended'
                    return <span style={{ color, fontWeight: 600 }}>{label}</span>
                  })()}
                </Descriptions.Item>
              )}
              {jobStatus?.summary && (
                <Descriptions.Item label="Summary">
                  <span style={{ fontSize: 10, color: C.muted }}>{jobStatus.summary}</span>
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
            onClick={() => { if (crawlerMode === 'ai') { /* aiHealth refetches automatically */ } }} style={{ color: C.muted }} />
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
            {health.active_jobs !== undefined && (
              <Descriptions.Item label="Active Jobs">{String(health.active_jobs)}</Descriptions.Item>
            )}
            {health.port && <Descriptions.Item label="Port">{String(health.port)}</Descriptions.Item>}
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

          {/* Phase strip */}
          {crawlPhase !== 'idle' && (
            <div style={{
              padding: '8px 16px', borderBottom: `1px solid ${C.border}`,
              background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
              display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flexShrink: 0,
            }}>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '1px 8px', borderRadius: 10,
                background: crawlPhase === 'bfs' ? C.blue + '33' : C.green + '33',
                color: crawlPhase === 'bfs' ? C.blue : C.green,
                border: `1px solid ${crawlPhase === 'bfs' ? C.blue : C.green}44`,
                ...MONO,
              }}>
                {crawlPhase === 'bfs' ? '● GRAPH CRAWL' : '✓ DONE'}
              </span>
              {currentPage && (
                <span style={{ ...MONO, fontSize: 11, color: C.text }}>
                  <span style={{ color: C.muted }}>Account: </span>{currentPage}
                </span>
              )}
              {bfsProgress && (
                <span style={{ ...MONO, fontSize: 11, color: C.muted, marginLeft: 'auto' }}>
                  {bfsProgress}
                </span>
              )}
            </div>
          )}

          <div ref={logRef} style={{ flex: 1, overflowY: 'auto', padding: '8px 0', ...MONO, fontSize: 12 }}>
            {events.length === 0 ? (
              <div style={{ padding: '24px 16px', color: C.muted, textAlign: 'center', fontSize: 12 }}>
                {crawlJobId ? 'Waiting for events…' : 'Configure and start a crawl to see live output here.'}
              </div>
            ) : events.map((ev, i) => (
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
            ))}
          </div>
        </div>
      </Content>
    </Layout>
  )
}

// ── Knowledge Base tab — V3 normalized graph ─────────────────────────────────
function KnowledgeBaseTab({ C, active }: { C: typeof DARK; active: boolean }) {
  const reduxAppId  = useAppSelector(s => s.app.appId)
  const targetTool  = useAppSelector(s => s.app.targetTool)
  const refreshKey  = useAppSelector(s => s.app.kbRefreshKey)

  // Local appId input so users can load any graph without going through the Crawl tab
  const [localAppId, setLocalAppId] = useState(reduxAppId)
  const [graph,      setGraph]      = useState<Record<string, unknown> | null>(null)
  const [loading,    setLoading]    = useState(false)
  const [fetchedAt,  setFetchedAt]  = useState<string | null>(null)
  const [source,     setSource]     = useState<'ai' | 'graph' | null>(null)
  const [error,      setError]      = useState<string | null>(null)

  // Keep local input in sync when redux appId changes (e.g. after triggering a crawl)
  useEffect(() => { if (reduxAppId) setLocalAppId(reduxAppId) }, [reduxAppId])

  const fileExt = targetTool === 'selenium-csharp' ? '.cs'
    : targetTool === 'selenium-python' ? '.py'
    : targetTool === 'playwright-js' ? '.js'
    : targetTool === 'playwright-ts' ? '.ts'
    : targetTool === 'playwright-python' ? '.py'
    : targetTool === 'cypress-js' ? '.js'
    : targetTool === 'cypress-ts' ? '.ts'
    : '.java'

  const doFetch = React.useCallback(async (aid: string) => {
    if (!aid.trim()) return
    setLoading(true)
    setError(null)
    try {
      // Try AI crawler first (most recent for default crawlerMode=ai),
      // then fall back to graph crawler endpoint which also reads shared/outputs on disk.
      const tryUrls: Array<[string, 'ai' | 'graph']> = [
        [`/api/v3/ai/graph/${encodeURIComponent(aid.trim())}`, 'ai'],
        [`/api/v3/graph/${encodeURIComponent(aid.trim())}`,    'graph'],
      ]
      let found = false
      for (const [url, src] of tryUrls) {
        try {
          const r = await fetch(url, { cache: 'no-store' })
          if (r.ok) {
            const data = await r.json()
            // Validate it looks like a graph (has nodes array or object)
            if (data && (Array.isArray(data.nodes) || (typeof data.nodes === 'object' && data.nodes))) {
              setGraph(data)
              setSource(src)
              setFetchedAt(new Date().toISOString())
              found = true
              break
            }
          }
        } catch { /* try next */ }
      }
      if (!found) {
        setGraph(null)
        setSource(null)
        setError(`No graph found for "${aid.trim()}" — run a crawl first.`)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  // Auto-fetch when tab becomes active, appId changes, or a crawl completes
  useEffect(() => {
    if (active && localAppId) doFetch(localAppId)
  }, [active, refreshKey, doFetch]) // eslint-disable-line react-hooks/exhaustive-deps

  const meta = graph?.meta as Record<string, unknown> | undefined

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
        paddingBottom: 12, borderBottom: `1px solid ${C.border}`, flexShrink: 0, flexWrap: 'wrap',
      }}>
        <DatabaseOutlined style={{ color: C.blue, fontSize: 16 }} />
        <span style={{ ...MONO, fontSize: 14, fontWeight: 600, color: C.text }}>Knowledge Base</span>

        {/* App ID input — lets users load any graph directly */}
        <Input
          size="small"
          value={localAppId}
          onChange={e => setLocalAppId(e.target.value)}
          onPressEnter={() => doFetch(localAppId)}
          placeholder="app-id"
          style={{ width: 180, ...MONO, fontSize: 12 }}
          suffix={
            <Button
              type="text" size="small"
              icon={<SyncOutlined spin={loading} />}
              onClick={() => doFetch(localAppId)}
              style={{ padding: 0, height: 20, color: C.muted }}
            />
          }
        />

        {source && (
          <Tag color={source === 'ai' ? 'purple' : 'cyan'} style={{ ...MONO, fontSize: 10 }}>
            {source === 'ai' ? 'AI crawler' : 'Graph crawler'}
          </Tag>
        )}

        {!!meta && (
          <>
            <Tag color="green"  style={{ ...MONO, fontSize: 11 }}>{String(meta.totalNodes ?? 0)} pages</Tag>
            <Tag color="blue"   style={{ ...MONO, fontSize: 11 }}>{String(meta.totalEdges ?? 0)} edges</Tag>
            {(meta.unfilledFields as number) > 0 && (
              <Tag color="orange" style={{ ...MONO, fontSize: 11 }}>{String(meta.unfilledFields)} unfilled</Tag>
            )}
          </>
        )}

        {!!meta?.crawledAt && (
          <span style={{ ...MONO, fontSize: 10, color: C.muted }}>
            crawled {new Date(String(meta.crawledAt)).toLocaleString()}
          </span>
        )}

        {!!fetchedAt && (
          <span style={{ ...MONO, fontSize: 10, color: C.muted }}>
            · fetched {new Date(fetchedAt).toLocaleTimeString()}
          </span>
        )}

        {!!meta?.summary && (
          <Tooltip title={String(meta.summary)}>
            <Tag color="default" style={{ ...MONO, fontSize: 10, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'help' }}>
              {String(meta.summary)}
            </Tag>
          </Tooltip>
        )}
      </div>

      {/* ── Eval panel ── */}
      {!!meta?.eval && (() => {
        const ev = meta.eval as {
          score: number; grade: string; evaluatedAt?: string
          dimensions: Record<string, { score: number; notes: string }>
          specQuality: { score: number; notes: string; recommendation: string } | null
          flags: string[]
        }
        const gradeColor = ev.grade === 'A' ? C.green : ev.grade === 'B' ? C.blue : ev.grade === 'C' ? C.amber : C.red
        const dimKeys: Array<[string, string]> = [
          ['coverage',            'Coverage'],
          ['interactionAccuracy', 'Interaction'],
          ['graphQuality',        'Graph Quality'],
          ['routePrediction',     'Route Predict'],
        ]
        const recColor = (r: string) => r === 'ready' ? C.green : r === 'review_required' ? C.amber : C.red
        const flagColor = (f: string) => f.startsWith('ERROR') ? C.red : f.startsWith('WARN') ? C.amber : C.muted
        return (
          <div style={{ marginBottom: 16, flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ ...MONO, fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Crawl Eval</span>
              {ev.evaluatedAt && (
                <span style={{ ...MONO, fontSize: 10, color: C.muted }}>
                  · {new Date(ev.evaluatedAt).toLocaleString()}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {/* Overall score */}
              <div style={{ background: C.surface2, border: `1px solid ${gradeColor}55`, borderRadius: 8, padding: '10px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 80 }}>
                <span style={{ ...MONO, fontSize: 22, fontWeight: 700, color: gradeColor }}>{ev.grade}</span>
                <span style={{ ...MONO, fontSize: 12, color: C.text }}>{ev.score}/100</span>
              </div>
              {/* Dimension scores */}
              {dimKeys.map(([key, label]) => {
                const dim = ev.dimensions[key]
                if (!dim) return null
                const c = dim.score >= 90 ? C.green : dim.score >= 70 ? C.amber : C.red
                return (
                  <Tooltip key={key} title={dim.notes}>
                    <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 14px', cursor: 'help', minWidth: 90 }}>
                      <div style={{ ...MONO, fontSize: 10, color: C.muted, marginBottom: 3 }}>{label}</div>
                      <div style={{ ...MONO, fontSize: 16, fontWeight: 600, color: c }}>{dim.score}<span style={{ fontSize: 10, color: C.muted }}>/100</span></div>
                    </div>
                  </Tooltip>
                )
              })}
              {/* Spec quality */}
              {ev.specQuality && (
                <Tooltip title={ev.specQuality.notes}>
                  <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 14px', cursor: 'help', minWidth: 90 }}>
                    <div style={{ ...MONO, fontSize: 10, color: C.muted, marginBottom: 3 }}>Spec Quality</div>
                    <div style={{ ...MONO, fontSize: 16, fontWeight: 600, color: recColor(ev.specQuality.recommendation) }}>
                      {ev.specQuality.score}<span style={{ fontSize: 10, color: C.muted }}>/100</span>
                    </div>
                    <div style={{ ...MONO, fontSize: 9, color: recColor(ev.specQuality.recommendation), marginTop: 2 }}>
                      {ev.specQuality.recommendation.replace('_', ' ')}
                    </div>
                  </div>
                </Tooltip>
              )}
              {/* Flags */}
              {ev.flags.length > 0 && (
                <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 14px', maxWidth: 340, overflow: 'hidden' }}>
                  <div style={{ ...MONO, fontSize: 10, color: C.muted, marginBottom: 4 }}>{ev.flags.length} flag{ev.flags.length !== 1 ? 's' : ''}</div>
                  {ev.flags.slice(0, 4).map((f, i) => (
                    <div key={i} style={{ ...MONO, fontSize: 10, color: flagColor(f), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.7 }}>{f}</div>
                  ))}
                  {ev.flags.length > 4 && <div style={{ ...MONO, fontSize: 10, color: C.muted }}>+{ev.flags.length - 4} more…</div>}
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {/* Graph view fills remaining height */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {loading && !graph ? (
          <div style={{ textAlign: 'center', padding: 48, color: C.muted, ...MONO, fontSize: 13 }}>
            Loading graph…
          </div>
        ) : error ? (
          <div style={{ textAlign: 'center', padding: 48, color: C.muted, ...MONO, fontSize: 13 }}>
            {error}
          </div>
        ) : !graph ? (
          <div style={{ textAlign: 'center', padding: 48, color: C.muted, ...MONO, fontSize: 13 }}>
            {localAppId ? `Enter an App ID and press ↵ to load.` : 'Enter an App ID above to load its graph.'}
          </div>
        ) : (
          <GraphView
            data={graph as unknown as Parameters<typeof GraphView>[0]['data']}
            fileExt={fileExt}
          />
        )}
      </div>
    </div>
  )
}

// ── Root AppV3 ────────────────────────────────────────────────────────────────
export default function AppV3() {
  const dispatch = useAppDispatch()
  const isDark   = useAppSelector(s => s.app.isDark)
  const C        = isDark ? DARK : LIGHT

  const [activeTab, setActiveTab] = useState('crawl')
  const { data: health } = useV3GetCrawlHealthQuery()

  const TAB_LABEL: React.CSSProperties = { ...MONO, fontSize: 13, fontWeight: 500, letterSpacing: '0.02em' }

  const tabItems = [
    {
      key: 'crawl',
      label: <span style={TAB_LABEL}><ThunderboltOutlined style={{ marginRight: 6 }} />Graph Crawl</span>,
    },
    {
      key: 'graph',
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
            <Tag color="purple" style={{ ...MONO, fontSize: 11, margin: 0 }}>Graph Crawler</Tag>

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

            {/* Health pill */}
            <Tooltip title={`Graph Crawler service: ${health?.status ?? 'checking…'}`}>
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
            <div style={{ display: activeTab === 'crawl' ? 'flex' : 'none', flex: 1, minHeight: 0, overflow: 'hidden' }}>
              <CrawlTab C={C} isDark={isDark} />
            </div>

            <div style={{ display: activeTab === 'graph' ? 'flex' : 'none', flex: 1, minHeight: 0, overflow: 'hidden', padding: 24, flexDirection: 'column' }}>
              <KnowledgeBaseTab C={C} active={activeTab === 'graph'} />
            </div>

            <div style={{ display: activeTab === 'td' ? 'block' : 'none', flex: 1, overflow: 'auto', padding: 24 }}>
              <TestDesignTab onGoToExecution={() => setActiveTab('ex')} />
            </div>

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
          ::-webkit-scrollbar { width: 6px; height: 6px; }
          ::-webkit-scrollbar-track { background: transparent; }
          ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }
        `}</style>
      </ConfigProvider>
    </ThemeContext.Provider>
  )
}
