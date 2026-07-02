import React, { useState } from 'react'
import { Button, Upload, Typography, Table, Checkbox, Tag, message, Modal, Input, Switch, Tooltip } from 'antd'
import { InboxOutlined, EditOutlined, PlusOutlined, ReloadOutlined, DeleteOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons'
import type { CheckboxChangeEvent } from 'antd/es/checkbox'
import type { TableColumnsType } from 'antd'
import type { UploadFile } from 'antd/es/upload'
import { useTheme } from '../theme'
import { useAppSelector } from '../store'
import { usePlanRunMutation, useSavePlanMutation, useLazyGetPlanStatusQuery, useTriggerCrawlMutation } from '../store/api'
import type { RawTestCase, RawTestCaseStep, PlanResult, PlanStep, Parameter, PlanEval } from '../types'

const { Text } = Typography

function ConfBadge({ conf }: { conf?: number | null }) {
  if (conf == null) return null
  const n = Number(conf)
  if (n >= 0.90) return <Tag color="success" style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11 }}>High confidence</Tag>
  if (n >= 0.75) return <Tag color="warning" style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11 }}>Review recommended</Tag>
  return           <Tag color="error"   style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11 }}>Needs review</Tag>
}

function StepIndicator({ step }: { step: number }) {
  const { C } = useTheme()
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 28 }}>
      {['1 Load', '2 Plan', '3 Save'].map((label, i) => (
        <React.Fragment key={i}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, whiteSpace: 'nowrap', color: step === i + 1 ? C.text : C.muted, paddingBottom: 4, borderBottom: `2px solid ${step === i + 1 ? C.blue : 'transparent'}` }}>
              {label}
            </span>
          </div>
          {i < 2 && <div style={{ flex: 1, height: 1, background: C.border, margin: '0 8px 6px', minWidth: 40 }} />}
        </React.Fragment>
      ))}
    </div>
  )
}

type PlanStatus = 'not_started' | 'in_progress' | 'complete' | 'failed'
interface Planned { status: PlanStatus; result: PlanResult | null; error: string | null }

interface EditingStep {
  tcName:       string
  stepIndex:    number
  draft:        PlanStep
}

interface RecrawlModal {
  open:     boolean
  tcName:   string
  url:      string
  intent:   string
  headless: boolean
}

interface Props { onGoToExecution: () => void }

function deriveIntent(steps: PlanStep[]): string {
  return steps
    .map(s => s.humanReadable ?? s.action ?? '')
    .filter(Boolean)
    .join('; ')
}

function blankStep(stepNumber: number): PlanStep {
  return {
    stepNumber,
    excelStepRef: 0,
    pageClass:    '',
    methodName:   '',
    hasParameter: false,
    parameterName: '',
    parameterType: 'String',
    isNavigation:  false,
    humanReadable: '',
  }
}

export default function TestDesignTab({ onGoToExecution }: Props) {
  const { C, isDark } = useTheme()
  const appId        = useAppSelector(s => s.app.appId)
  const appUrl       = useAppSelector(s => s.app.appUrl)
  const frameworkDir = useAppSelector(s => s.app.frameworkDir)

  const [uiStep, setUiStep]               = useState(1)
  const [loadError, setLoadError]         = useState('')
  const [loadingExcel, setLoadingExcel]   = useState(false)
  const [fileList, setFileList]           = useState<UploadFile[]>([])
  const [tcs, setTcs]                     = useState<RawTestCase[]>([])
  const [selectedKeys, setSelectedKeys]   = useState<number[]>([])
  const [planned, setPlanned]             = useState<Record<string, Planned>>({})
  const [planRunning, setPlanRunning]     = useState(false)
  const [saveError, setSaveError]         = useState('')
  const [plannerUsage, setPlannerUsage]   = useState<{ totalCalls: number; totalInputTokens: number; totalOutputTokens: number; totalCostUsd: number } | null>(null)
  const [savedFiles, setSavedFiles]       = useState<{ cls: string; names: string[] }[]>([])

  // Step edits: user-overridden steps per tc_name
  const [stepEdits, setStepEdits]         = useState<Record<string, PlanStep[]>>({})
  // Currently open inline editor
  const [editingStep, setEditingStep]     = useState<EditingStep | null>(null)
  // Re-crawl modal state
  const [recrawlModal, setRecrawlModal]   = useState<RecrawlModal | null>(null)
  const [recrawling, setRecrawling]       = useState(false)

  const [planRun]         = usePlanRunMutation()
  const [savePlan]        = useSavePlanMutation()
  const [fetchPlanStatus] = useLazyGetPlanStatusQuery()
  const [triggerCrawl]    = useTriggerCrawlMutation()

  const selectedTcs   = selectedKeys.map(i => tcs[i]).filter(Boolean)
  const selectedNames = selectedTcs.map(tc => tc.tc_name ?? tc.name ?? '')

  // Returns the effective steps for a tc (user edits if any, else planner result)
  const effectiveSteps = (tcName: string): PlanStep[] => {
    if (stepEdits[tcName]) return stepEdits[tcName]
    return planned[tcName]?.result?.steps ?? planned[tcName]?.result?.plan_steps ?? []
  }

  // ── Step 1 ────────────────────────────────────────────────────────────────
  const doUploadExcel = async (file: File) => {
    setLoadError('')
    setLoadingExcel(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const resp = await fetch('/dashboard/api/plan/upload-excel', { method: 'POST', body: form })
      const data = await resp.json()
      if (data.status === 'ERROR') throw new Error(data.detail ?? 'Failed to load')
      setTcs(data.test_cases ?? [])
      setSelectedKeys([])
    } catch (e: unknown) {
      const err = e as Error
      setLoadError(err?.message ?? 'Failed to load')
      message.error('Failed to parse Excel file')
    } finally {
      setLoadingExcel(false)
    }
    return false
  }

  const stepsCols: TableColumnsType<RawTestCaseStep & { _k: number }> = [
    { title: '#', dataIndex: 'number', width: 36,
      render: (v: unknown) => <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: C.muted }}>{String(v ?? '')}</span> },
    { title: 'Step', dataIndex: 'step',
      render: (v: unknown) => <span style={{ fontSize: 12, color: C.text }}>{String(v ?? '')}</span> },
    { title: 'Expected Result', dataIndex: 'expected',
      render: (v: unknown) => <span style={{ fontSize: 12, color: C.muted }}>{String(v ?? '')}</span> },
  ]

  const step1Cols: TableColumnsType<RawTestCase & { _i: number }> = [
    {
      title: (
        <Checkbox
          checked={selectedKeys.length === tcs.length && tcs.length > 0}
          indeterminate={selectedKeys.length > 0 && selectedKeys.length < tcs.length}
          onChange={(e: CheckboxChangeEvent) => setSelectedKeys(e.target.checked ? tcs.map((_, i) => i) : [])}
        />
      ),
      width: 40,
      render: (_: unknown, row: RawTestCase & { _i: number }) => (
        <Checkbox
          checked={selectedKeys.includes(row._i)}
          onChange={(e: CheckboxChangeEvent) =>
            setSelectedKeys(prev => e.target.checked ? [...prev, row._i] : prev.filter(k => k !== row._i))
          }
        />
      ),
    },
    {
      title: 'Test Case Name',
      render: (_: unknown, row: RawTestCase & { _i: number }) => (
        <Text style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: C.text }}>{row.tc_name ?? row.name ?? ''}</Text>
      ),
    },
    {
      title: 'Description',
      render: (_: unknown, row: RawTestCase & { _i: number }) => (
        <Text style={{ color: C.muted, fontSize: 12 }}>{row.description ?? ''}</Text>
      ),
    },
    {
      title: 'Steps',
      width: 60,
      render: (_: unknown, row: RawTestCase & { _i: number }) => (
        <Tag style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11 }}>{(row.steps ?? []).length}</Tag>
      ),
    },
  ]

  // ── Step 2 planner ────────────────────────────────────────────────────────
  const runPlannerForTcs = async (tcsToRun: RawTestCase[]) => {
    setPlanRunning(true)
    setPlanned(prev => {
      const next = { ...prev }
      tcsToRun.forEach(tc => {
        const name = tc.tc_name ?? tc.name ?? ''
        next[name] = { status: 'not_started', result: null, error: null }
      })
      return next
    })
    for (const tc of tcsToRun) {
      const name = tc.tc_name ?? tc.name ?? ''
      setPlanned(prev => ({ ...prev, [name]: { status: 'in_progress', result: null, error: null } }))
      try {
        await planRun({ app_id: appId, tc_name: name, description: tc.description ?? '', java_dir: frameworkDir, steps: tc.steps ?? [] }).unwrap()
        await new Promise<void>((resolve, reject) => {
          const since = new Date().toISOString()
          const sse = new EventSource(`/dashboard/api/events/${encodeURIComponent(appId)}/stream?since=${encodeURIComponent(since)}`)
          const timer = setTimeout(() => { sse.close(); reject(new Error('Timed out waiting for planner result')) }, 120000)
          sse.onmessage = (ev) => {
            try {
              const event = JSON.parse(ev.data)
              if (event.stage !== 'PLANNER_RESULT') return
              const payload = JSON.parse(event.message)
              if ((payload.tc_name ?? '') !== name) return
              clearTimeout(timer)
              sse.close()
              const result: PlanResult = {
                steps:         (payload.steps ?? []) as PlanStep[],
                parameters:    (payload.parameters ?? []) as Parameter[],
                confidence:    payload.confidence,
                class_name:    payload.class_name,
                review_reason: payload.review_reason,
                eval:          payload.eval as PlanEval | undefined,
              }
              setPlanned(prev => ({ ...prev, [name]: { status: 'complete', result, error: null } }))
              // Clear any prior edits so the new plan shows fresh
              setStepEdits(prev => { const next = { ...prev }; delete next[name]; return next })
              if (payload.llm_usage?.totalCalls != null) {
                setPlannerUsage(payload.llm_usage)
              } else {
                fetch(`/dashboard/api/plan/usage/${encodeURIComponent(appId)}`)
                  .then(r => r.json()).then(u => setPlannerUsage(u)).catch(() => {})
              }
              resolve()
            } catch { /* ignore non-JSON events */ }
          }
          sse.onerror = () => { clearTimeout(timer); sse.close(); reject(new Error('SSE connection error')) }
        })
      } catch (e: unknown) {
        const err = e as { data?: { detail?: string }; error?: string; message?: string }
        setPlanned(prev => ({ ...prev, [name]: { status: 'failed', result: null, error: err?.data?.detail ?? err?.error ?? err?.message ?? 'Failed' } }))
      }
    }
    setPlanRunning(false)
  }

  const runPlanner = () => runPlannerForTcs(selectedTcs)

  // ── Step edit handlers ────────────────────────────────────────────────────
  const startEdit = (tcName: string, stepIndex: number) => {
    const steps = effectiveSteps(tcName)
    setEditingStep({ tcName, stepIndex, draft: { ...steps[stepIndex] } })
  }

  const saveEdit = () => {
    if (!editingStep) return
    const { tcName, stepIndex, draft } = editingStep
    const steps = [...effectiveSteps(tcName)]
    steps[stepIndex] = draft
    setStepEdits(prev => ({ ...prev, [tcName]: steps }))
    setEditingStep(null)
  }

  const cancelEdit = () => setEditingStep(null)

  const addInteraction = (tcName: string) => {
    const steps = effectiveSteps(tcName)
    const newStep = blankStep(steps.length + 1)
    const updated = [...steps, newStep]
    setStepEdits(prev => ({ ...prev, [tcName]: updated }))
    setEditingStep({ tcName, stepIndex: updated.length - 1, draft: { ...newStep } })
  }

  const deleteStep = (tcName: string, stepIndex: number) => {
    const steps = effectiveSteps(tcName).filter((_, i) => i !== stepIndex)
    setStepEdits(prev => ({ ...prev, [tcName]: steps }))
    if (editingStep?.tcName === tcName && editingStep.stepIndex === stepIndex) setEditingStep(null)
  }

  // ── Re-crawl ─────────────────────────────────────────────────────────────
  const openRecrawl = (tcName: string) => {
    const steps = effectiveSteps(tcName)
    setRecrawlModal({
      open:     true,
      tcName,
      url:      appUrl,
      intent:   deriveIntent(steps),
      headless: true,
    })
  }

  const confirmRecrawl = async () => {
    if (!recrawlModal) return
    const { tcName, url, intent, headless } = recrawlModal
    setRecrawling(true)
    try {
      await triggerCrawl({
        app_id: appId, app_url: url,
        build_id: 'recrawl-' + Date.now(),
        trigger_type: 'UPDATE',
        flow_name: intent,
        headless,
      }).unwrap()

      // Wait for GENERATOR_COMPLETE then re-run planner
      await new Promise<void>((resolve) => {
        const since = new Date().toISOString()
        const sse = new EventSource(`/dashboard/api/events/${encodeURIComponent(appId)}/stream?since=${encodeURIComponent(since)}`)
        const timer = setTimeout(() => { sse.close(); resolve() }, 300000)
        sse.onmessage = (ev) => {
          try {
            const event = JSON.parse(ev.data)
            if (event.stage === 'GENERATOR_COMPLETE' || event.stage === 'POM_COMPLETE') {
              clearTimeout(timer); sse.close(); resolve()
            }
          } catch { /* ignore */ }
        }
        sse.onerror = () => { clearTimeout(timer); sse.close(); resolve() }
      })

      setRecrawlModal(null)
      message.success('Re-crawl complete — re-running planner')

      // Re-run planner for the affected test case
      const tc = selectedTcs.find(t => (t.tc_name ?? t.name) === tcName)
      if (tc) await runPlannerForTcs([tc])
    } catch (e: unknown) {
      const err = e as Error
      message.error(`Re-crawl failed: ${err?.message ?? 'Unknown error'}`)
    } finally {
      setRecrawling(false)
    }
  }

  const canSave = selectedNames.length > 0 && selectedNames.every(name => {
    const p = planned[name]
    if (!p || p.status !== 'complete') return false
    const conf = p.result?.confidence ?? p.result?.score
    return conf == null || Number(conf) >= 0.75
  })

  // ── Step 3 save ───────────────────────────────────────────────────────────
  const doSave = async () => {
    setSaveError('')
    const fileMap: Record<string, string[]> = {}
    selectedTcs.forEach(tc => {
      const name = tc.tc_name ?? tc.name ?? ''
      const cls  = planned[name]?.result?.class_name ?? (name.replace(/[^a-zA-Z0-9]/g, '') + 'Tests')
      if (!fileMap[cls]) fileMap[cls] = []
      fileMap[cls].push(name)
    })
    setSavedFiles(Object.entries(fileMap).map(([cls, names]) => ({ cls, names })))
    try {
      await savePlan({
        app_id: appId, java_dir: frameworkDir,
        test_cases: selectedTcs.map(tc => {
          const name = tc.tc_name ?? tc.name ?? ''
          const result = planned[name]?.result ?? null
          // Merge user edits into the saved result
          const mergedResult = result && stepEdits[name]
            ? { ...result, steps: stepEdits[name] }
            : result
          return { tc_name: name, result: mergedResult }
        }),
      }).unwrap()
    } catch (_) {}
    setUiStep(3)
  }

  // ── Render inline step row ────────────────────────────────────────────────
  const renderStepRow = (tcName: string, s: PlanStep, i: number, isLast: boolean) => {
    const isEditing = editingStep?.tcName === tcName && editingStep.stepIndex === i
    const desc   = s.humanReadable ?? s.action ?? s.pageClass ?? ''
    const cls    = s.page_class ?? s.pageClass ?? ''
    const method = s.method ?? s.methodName ?? ''
    const rawArgs = Array.isArray(s.params) ? s.params : Array.isArray(s.parameters) ? s.parameters : []
    const args   = rawArgs.join(', ')
    const call   = cls && method ? `${cls}.${method}(${args})` : method ? `${method}(${args})` : ''

    if (isEditing && editingStep) {
      const d = editingStep.draft
      return (
        <div key={i} style={{ padding: '8px 0', borderBottom: !isLast ? `1px solid ${C.border}` : 'none' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
            <Input
              size="small" placeholder="Description (humanReadable)"
              value={d.humanReadable ?? ''} style={{ fontSize: 12 }}
              onChange={e => setEditingStep(prev => prev ? { ...prev, draft: { ...prev.draft, humanReadable: e.target.value } } : null)}
            />
            <Input
              size="small" placeholder="Page class (e.g. LoginPage)"
              value={d.pageClass ?? ''} style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11 }}
              onChange={e => setEditingStep(prev => prev ? { ...prev, draft: { ...prev.draft, pageClass: e.target.value } } : null)}
            />
            <Input
              size="small" placeholder="Method name (e.g. enterEmail)"
              value={d.methodName ?? ''} style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11 }}
              onChange={e => setEditingStep(prev => prev ? { ...prev, draft: { ...prev.draft, methodName: e.target.value } } : null)}
            />
            <Input
              size="small" placeholder="Parameter name (leave blank if none)"
              value={d.parameterName ?? ''} style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11 }}
              onChange={e => setEditingStep(prev => prev ? { ...prev, draft: { ...prev.draft, parameterName: e.target.value, hasParameter: !!e.target.value } } : null)}
            />
          </div>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <Button size="small" icon={<CheckOutlined />} type="primary" onClick={saveEdit}>Save</Button>
            <Button size="small" icon={<CloseOutlined />} onClick={cancelEdit}>Cancel</Button>
          </div>
        </div>
      )
    }

    return (
      <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '6px 0', borderBottom: !isLast ? `1px solid ${C.border}` : 'none' }}>
        <span style={{ minWidth: 22, color: C.muted, fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, flexShrink: 0 }}>{i + 1}.</span>
        <span style={{ flex: 1, fontSize: 13, color: C.text }}>{desc}</span>
        {call && <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: C.blue, whiteSpace: 'nowrap' }}>[{call}]</span>}
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          <Tooltip title="Edit step">
            <Button size="small" type="text" icon={<EditOutlined style={{ fontSize: 11, color: C.muted }} />} onClick={() => startEdit(tcName, i)} />
          </Tooltip>
          <Tooltip title="Delete step">
            <Button size="small" type="text" icon={<DeleteOutlined style={{ fontSize: 11, color: C.red }} />} onClick={() => deleteStep(tcName, i)} />
          </Tooltip>
        </div>
      </div>
    )
  }

  return (
    <div>
      <StepIndicator step={uiStep} />

      {/* ── Step 1 ── */}
      {uiStep === 1 && (
        <div>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '16px 20px', marginBottom: 16 }}>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 16 }}>Load Test Cases</div>
            <Upload.Dragger
              accept=".xlsx,.xls"
              fileList={fileList}
              beforeUpload={file => { setFileList([file]); doUploadExcel(file); return false }}
              onRemove={() => { setFileList([]); setTcs([]); setSelectedKeys([]) }}
              maxCount={1}
              showUploadList={{ showRemoveIcon: true }}
              style={{ background: C.surface2, borderColor: C.border }}
            >
              {loadingExcel
                ? <p style={{ color: C.muted, fontFamily: "'IBM Plex Mono',monospace", fontSize: 13 }}>Parsing…</p>
                : <>
                    <p className="ant-upload-drag-icon"><InboxOutlined style={{ color: C.blue, fontSize: 40 }} /></p>
                    <p style={{ color: C.text, fontFamily: "'IBM Plex Mono',monospace", fontSize: 13 }}>Click or drag an Excel file here</p>
                    <p style={{ color: C.muted, fontSize: 12 }}>Expected columns: TestCaseName, Description</p>
                  </>
              }
            </Upload.Dragger>
            {loadError && <div style={{ color: C.red, fontSize: 12, fontFamily: "'IBM Plex Mono',monospace", marginTop: 8 }}>{loadError}</div>}
          </div>

          {tcs.length > 0 && (
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '16px 20px' }}>
              <Table<RawTestCase & { _i: number }>
                dataSource={tcs.map((tc, i) => ({ ...tc, _i: i, key: i }))}
                columns={step1Cols} pagination={false} size="small" scroll={{ y: 400 }}
                expandable={{
                  rowExpandable: row => (row.steps ?? []).length > 0,
                  expandedRowRender: row => (
                    <div style={{ padding: '8px 0 8px 40px' }}>
                      <Table<RawTestCaseStep & { _k: number }>
                        dataSource={(row.steps ?? []).map((s, k) => ({ ...s, _k: k, key: k }))}
                        columns={stepsCols} pagination={false} size="small" showHeader
                      />
                    </div>
                  ),
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                <Button type="primary" disabled={selectedKeys.length === 0} onClick={() => { setPlanned({}); setUiStep(2) }}>Next →</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Step 2 ── */}
      {uiStep === 2 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 15, fontWeight: 600, color: C.text }}>Plan Test Cases</div>
            <div style={{ flex: 1 }} />
            {plannerUsage && plannerUsage.totalCalls > 0 && (
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: C.muted, marginRight: 16 }}>
                LLM usage — planner:{' '}
                <span style={{ color: C.text }}>${plannerUsage.totalCostUsd?.toFixed(5)}</span>
                {' · '}{(plannerUsage.totalInputTokens ?? 0) + (plannerUsage.totalOutputTokens ?? 0)} tokens
                {' · '}{plannerUsage.totalCalls} call{plannerUsage.totalCalls !== 1 ? 's' : ''}
              </div>
            )}
            <Button type="primary" loading={planRunning} onClick={runPlanner}>Run Planner</Button>
          </div>

          {selectedTcs.map(tc => {
            const name = tc.tc_name ?? tc.name ?? ''
            const p    = planned[name]
            const status  = p?.status ?? 'not_started'
            const result  = p?.result ?? null
            const conf    = result?.confidence ?? result?.score
            const needsReview = conf != null && Number(conf) < 0.75
            const steps   = effectiveSteps(name)
            const params  = result?.parameters ?? result?.params ?? []
            const hasEdits = !!stepEdits[name]

            return (
              <div key={name} style={{ background: C.surface, border: `1px solid ${needsReview ? C.amber : C.border}`, borderRadius: 8, marginBottom: 14, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 10px' }}>
                  <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, fontWeight: 600, color: C.text }}>{name}</span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {hasEdits && (
                      <Tag color="blue" style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10 }}>edited</Tag>
                    )}
                    <ConfBadge conf={conf} />
                    {status === 'complete' && (
                      <Tooltip title="Re-crawl with edited steps as intent">
                        <Button size="small" icon={<ReloadOutlined />} onClick={() => openRecrawl(name)}>Re-crawl</Button>
                      </Tooltip>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: C.muted, padding: '0 16px 10px' }}>"{tc.description ?? ''}"</div>
                <div style={{ borderTop: `1px solid ${C.border}`, padding: '14px 16px' }}>
                  {status === 'not_started' && <span style={{ color: C.muted, fontSize: 12 }}>Not started — click Run Planner</span>}
                  {status === 'in_progress' && <span style={{ color: C.blue, fontSize: 12, fontFamily: "'IBM Plex Mono',monospace", animation: 'kb-pulse 1.2s ease-in-out infinite', display: 'inline-block' }}>● Planning…</span>}
                  {status === 'failed'      && <span style={{ color: C.red, fontSize: 12, fontFamily: "'IBM Plex Mono',monospace" }}>{p?.error}</span>}
                  {status === 'complete' && result && (
                    <>
                      <div style={{ color: C.green, fontSize: 12, marginBottom: 10 }}>✓ Planned — {steps.length} step{steps.length !== 1 ? 's' : ''}</div>
                      {steps.length > 0 && (() => {
                        // Group atomic steps by excelStepRef
                        const groups: { ref: number; label: string; items: { s: PlanStep; i: number }[] }[] = []
                        const refMap = new Map<number, typeof groups[0]>()
                        steps.forEach((s, i) => {
                          const ref = Number(s.excelStepRef ?? 0)
                          if (!refMap.has(ref)) {
                            const excelStep = tc.steps?.find(es => Number(es.number) === ref)
                            const label = ref > 0
                              ? `Step ${ref}${excelStep?.step ? ': ' + excelStep.step : ''}`
                              : 'Steps'
                            const g = { ref, label, items: [] as { s: PlanStep; i: number }[] }
                            groups.push(g)
                            refMap.set(ref, g)
                          }
                          refMap.get(ref)!.items.push({ s, i })
                        })
                        return (
                          <div style={{ marginBottom: 10 }}>
                            {groups.map(g => (
                              <div key={g.ref} style={{ marginBottom: 12 }}>
                                <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '8px 12px 4px', background: C.surface, borderRadius: '6px 6px 0 0', border: `1px solid ${C.border}`, borderBottom: 'none' }}>
                                  {g.label}
                                </div>
                                <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: '0 0 6px 6px', padding: '4px 12px' }}>
                                  {g.items.map(({ s, i }) => renderStepRow(name, s, i, i === steps.length - 1))}
                                </div>
                              </div>
                            ))}
                            {/* Add Interaction button */}
                            <Button
                              size="small" type="dashed" icon={<PlusOutlined />}
                              onClick={() => addInteraction(name)}
                              style={{ marginTop: 4, width: '100%', color: C.muted, borderColor: C.border }}
                            >
                              Add Interaction
                            </Button>
                          </div>
                        )
                      })()}
                      {params.length > 0 && (
                        <div style={{ fontSize: 12, color: C.muted, fontFamily: "'IBM Plex Mono',monospace" }}>
                          Parameters:{' '}
                          {params.map((p, i) => (
                            <span key={i}>{p.name ?? String(p)} <span style={{ color: C.muted }}>({p.type ?? 'String'})</span>{i < params.length - 1 ? '  ' : ''}</span>
                          ))}
                        </div>
                      )}
                      {needsReview && result.review_reason && (
                        <div style={{ color: C.amber, fontSize: 12, marginTop: 8, fontFamily: "'IBM Plex Mono',monospace" }}>⚠ {result.review_reason}</div>
                      )}
                      {result.eval && (() => {
                        const ev = result.eval!
                        const gradeColor = ev.grade === 'A' ? C.green : ev.grade === 'B' ? C.blue : ev.grade === 'C' ? C.amber : C.red
                        const dimLabels: [string, string][] = [
                          ['methodValidity',    'Methods'],
                          ['pathCoverage',      'Path'],
                          ['paramCompleteness', 'Params'],
                          ['stepCompleteness',  'Steps'],
                        ]
                        return (
                          <div style={{ marginTop: 10, padding: '10px 12px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                              <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Plan Eval</span>
                              <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 16, fontWeight: 700, color: gradeColor }}>{ev.grade}</span>
                              <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: C.text }}>{ev.score}/100</span>
                            </div>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: ev.flags?.length ? 6 : 0 }}>
                              {dimLabels.map(([key, label]) => {
                                const dim = ev.dimensions?.[key]
                                if (!dim) return null
                                const dc = dim.score >= 90 ? C.green : dim.score >= 70 ? C.amber : C.red
                                return (
                                  <div key={key} title={dim.notes} style={{ background: C.surface2, border: `1px solid ${dc}44`, borderRadius: 4, padding: '3px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                    <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: C.muted }}>{label}</span>
                                    <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, fontWeight: 600, color: dc }}>{Math.round(dim.score)}</span>
                                  </div>
                                )
                              })}
                            </div>
                            {ev.flags?.map((f, i) => (
                              <div key={i} style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: f.startsWith('ERROR') ? C.red : C.amber, marginTop: 2 }}>{f}</div>
                            ))}
                          </div>
                        )
                      })()}
                    </>
                  )}
                </div>
              </div>
            )
          })}

          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <Button onClick={() => setUiStep(1)}>← Back</Button>
            <div style={{ flex: 1 }} />
            <Button type="primary" disabled={!canSave} onClick={doSave} style={{ background: canSave ? C.green : undefined, borderColor: canSave ? C.green : undefined }}>Save →</Button>
          </div>
        </div>
      )}

      {/* ── Step 3 ── */}
      {uiStep === 3 && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '16px 20px' }}>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 16 }}>Save Test Cases</div>
          <div style={{ color: C.muted, fontSize: 13, fontFamily: "'IBM Plex Mono',monospace", marginBottom: 14 }}>
            Saving to {frameworkDir}/src/test/java/tests/generated/…
          </div>
          {saveError && <div style={{ color: C.red, fontSize: 12, fontFamily: "'IBM Plex Mono',monospace", marginBottom: 10 }}>{saveError}</div>}
          <ul style={{ listStyle: 'none', margin: '0 0 20px', padding: 0 }}>
            {savedFiles.map((f, i) => (
              <li key={i} style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: C.muted, padding: '4px 0' }}>
                <span style={{ color: C.green }}>✓ </span>{f.cls}.java — {f.names.join(', ')}
              </li>
            ))}
          </ul>
          <div style={{ display: 'flex', gap: 10 }}>
            <Button onClick={() => setUiStep(2)}>← Back to Plan</Button>
            <div style={{ flex: 1 }} />
            <Button type="primary" onClick={onGoToExecution}>Go to Execution →</Button>
          </div>
        </div>
      )}

      {/* ── Re-crawl Modal ── */}
      {recrawlModal && (
        <Modal
          open={recrawlModal.open}
          title={<span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 14 }}>Re-crawl with Guided Intent</span>}
          onCancel={() => setRecrawlModal(null)}
          footer={[
            <Button key="cancel" onClick={() => setRecrawlModal(null)}>Cancel</Button>,
            <Button key="confirm" type="primary" loading={recrawling} icon={<ReloadOutlined />} onClick={confirmRecrawl}>
              Start Re-crawl
            </Button>,
          ]}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '8px 0' }}>
            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4, fontFamily: "'IBM Plex Mono',monospace" }}>App URL</div>
              <Input
                value={recrawlModal.url}
                placeholder="https://your-app.example.com"
                onChange={e => setRecrawlModal(prev => prev ? { ...prev, url: e.target.value } : null)}
              />
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4, fontFamily: "'IBM Plex Mono',monospace" }}>
                Flow Intent <span style={{ fontWeight: 400, color: '#999' }}>(derived from your edited steps — refine as needed)</span>
              </div>
              <Input.TextArea
                rows={4}
                value={recrawlModal.intent}
                onChange={e => setRecrawlModal(prev => prev ? { ...prev, intent: e.target.value } : null)}
                style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12 }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Switch
                checked={recrawlModal.headless}
                onChange={v => setRecrawlModal(prev => prev ? { ...prev, headless: v } : null)}
              />
              <span style={{ fontSize: 13 }}>Headless mode</span>
            </div>
          </div>
        </Modal>
      )}

      <style>{`
        @keyframes kb-pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        .ant-table-wrapper .ant-table { background: transparent !important; }
        .ant-table-wrapper .ant-table-thead > tr > th { background: ${C.surface2} !important; color: ${C.muted} !important; font-family: 'IBM Plex Mono',monospace; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
        .ant-table-wrapper .ant-table-tbody > tr > td { border-color: ${C.border} !important; }
        .ant-table-wrapper .ant-table-tbody > tr:hover > td { background: ${isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)'} !important; }
      `}</style>
    </div>
  )
}
