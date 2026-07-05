import React, { useState, useEffect, useRef } from 'react'
import { Button, Tag, Modal, Input, Switch, Tooltip, message, Col, Row } from 'antd'
import {
  EditOutlined, PlusOutlined, ReloadOutlined, DeleteOutlined,
  CheckOutlined, CloseOutlined, SaveOutlined, CodeOutlined,
  DownOutlined, RightOutlined, DownloadOutlined,
  CaretUpOutlined, CaretDownOutlined,
} from '@ant-design/icons'
import { useTheme } from '../theme'
import { useAppSelector } from '../store'
import {
  usePlanRunMutation, useSavePlanMutation, useTriggerCrawlMutation,
  useGetTestCasesQuery,
} from '../store/api'
import type { RawTestCase, RawTestCaseStep, PlanResult, PlanStep, Parameter, PlanEval, TestCase } from '../types'

const MONO: React.CSSProperties = { fontFamily: "'IBM Plex Mono', monospace" }

// ── Confidence badge ──────────────────────────────────────────────────────────

function ConfBadge({ conf }: { conf?: number | null }) {
  if (conf == null) return null
  const n = Number(conf)
  if (n >= 0.90) return <Tag color="success" style={{ ...MONO, fontSize: 11 }}>High confidence</Tag>
  if (n >= 0.75) return <Tag color="warning" style={{ ...MONO, fontSize: 11 }}>Review recommended</Tag>
  return <Tag color="error" style={{ ...MONO, fontSize: 11 }}>Needs review</Tag>
}

// ── Design row model ──────────────────────────────────────────────────────────

type PlanStatus = 'idle' | 'running' | 'done' | 'failed'

interface DesignRow {
  id: string                       // unique key: tc_name
  tc_name: string
  description: string
  rawSteps: RawTestCaseStep[]      // imported from Excel
  source: 'api' | 'excel'
  file_path?: string               // truthy = already Automated
  method_name?: string             // generated/saved method name
  apiConfidence?: number
  planStatus: PlanStatus
  planResult: PlanResult | null
  stepEdits: PlanStep[] | null
  saveStatus: 'unsaved' | 'saving' | 'saved' | 'error'
  expanded: boolean
  expandedPanel: 'imported' | 'generated'
}

function makeApiRow(tc: TestCase): DesignRow {
  const hasPlanSteps = tc.plan_steps && tc.plan_steps.length > 0
  return {
    id: tc.tc_name,
    tc_name: tc.tc_name,
    description: '',
    rawSteps: (tc as any).raw_steps ?? [],
    source: 'api',
    file_path: tc.file_path || undefined,
    method_name: tc.method_name || undefined,
    apiConfidence: tc.confidence,
    planStatus: hasPlanSteps ? 'done' : 'idle',
    planResult: hasPlanSteps
      ? { steps: tc.plan_steps, parameters: tc.parameters ?? [], confidence: tc.confidence }
      : null,
    stepEdits: null,
    saveStatus: tc.file_path ? 'saved' : 'unsaved',
    expanded: false,
    expandedPanel: 'generated',
  }
}

function makeExcelRow(tc: RawTestCase): DesignRow {
  const name = tc.tc_name ?? tc.name ?? ''
  return {
    id: name,
    tc_name: name,
    description: tc.description ?? '',
    rawSteps: tc.steps ?? [],
    source: 'excel',
    file_path: undefined,
    planStatus: 'idle',
    planResult: null,
    stepEdits: null,
    saveStatus: 'unsaved',
    expanded: false,
    expandedPanel: 'imported',
  }
}

function blankStep(stepNumber: number): PlanStep {
  return {
    stepNumber, excelStepRef: 0, pageClass: '', methodName: '',
    hasParameter: false, parameterName: '', parameterType: 'String',
    isNavigation: false, humanReadable: '',
  }
}

function deriveIntent(steps: PlanStep[]): string {
  return steps.map(s => s.humanReadable ?? s.action ?? '').filter(Boolean).join('; ')
}

// ── Import Excel modal ────────────────────────────────────────────────────────

function ImportModal({ open, onClose, onImport, C }: {
  open: boolean
  onClose: () => void
  onImport: (tcs: RawTestCase[]) => void
  C: ReturnType<typeof useTheme>['C']
}) {
  const [parsed,   setParsed]   = useState<RawTestCase[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) { setParsed([]); setSelected(new Set()); setError('') }
  }, [open])

  const handleFile = async (file: File) => {
    setLoading(true); setError('')
    try {
      const form = new FormData()
      form.append('file', file)
      const resp = await fetch('/dashboard/api/plan/upload-excel', { method: 'POST', body: form })
      const data = await resp.json()
      if (data.status === 'ERROR') throw new Error(data.detail ?? 'Failed to parse')
      const tcs: RawTestCase[] = data.test_cases ?? []
      setParsed(tcs)
      setSelected(new Set(tcs.map(tc => tc.tc_name ?? tc.name ?? '')))
    } catch (e: unknown) {
      setError((e as Error)?.message ?? 'Failed to parse file')
    } finally {
      setLoading(false)
    }
  }

  const toggle = (name: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(name)) next.delete(name); else next.add(name)
    return next
  })

  const toggleAll = () => setSelected(prev =>
    prev.size === parsed.length ? new Set() : new Set(parsed.map(tc => tc.tc_name ?? tc.name ?? ''))
  )

  const handleImport = () => {
    const toImport = parsed.filter(tc => selected.has(tc.tc_name ?? tc.name ?? ''))
    onImport(toImport)
  }

  return (
    <Modal
      open={open} onCancel={onClose} footer={null}
      title={<span style={{ ...MONO, fontSize: 14 }}>Import Test Cases</span>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
          <Button icon={<DownloadOutlined />} loading={loading}
            onClick={() => fileRef.current?.click()}>
            Select Excel File (.xlsx)
          </Button>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 4, ...MONO }}>
            Expected columns: TestCaseName, Description, Steps
          </div>
        </div>

        {error && <div style={{ color: C.red, fontSize: 12, ...MONO }}>{error}</div>}

        {parsed.length > 0 && (
          <>
            <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span style={{ ...MONO, fontSize: 12, color: C.text, fontWeight: 600 }}>
                  {parsed.length} test case{parsed.length !== 1 ? 's' : ''} found
                </span>
                <button onClick={toggleAll}
                  style={{ background: 'none', border: 'none', color: C.blue, cursor: 'pointer', ...MONO, fontSize: 11 }}>
                  {selected.size === parsed.length ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              <div style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {parsed.map(tc => {
                  const name = tc.tc_name ?? tc.name ?? ''
                  const checked = selected.has(name)
                  return (
                    <div key={name} onClick={() => toggle(name)} style={{
                      display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 10px',
                      background: checked ? C.surface2 : 'transparent',
                      border: `1px solid ${checked ? C.blue : C.border}`, borderRadius: 6, cursor: 'pointer',
                    }}>
                      <input type="checkbox" checked={checked} readOnly style={{ marginTop: 2, flexShrink: 0 }} />
                      <div>
                        <div style={{ ...MONO, fontSize: 12, color: C.text, fontWeight: 600 }}>{name}</div>
                        {tc.description && (
                          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{tc.description}</div>
                        )}
                        {(tc.steps ?? []).length > 0 && (
                          <div style={{ ...MONO, fontSize: 10, color: C.muted, marginTop: 2 }}>
                            {(tc.steps ?? []).length} step{(tc.steps ?? []).length !== 1 ? 's' : ''}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <Button onClick={onClose}>Cancel</Button>
              <Button type="primary" disabled={selected.size === 0} onClick={handleImport}>
                Import {selected.size} test case{selected.size !== 1 ? 's' : ''}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

// ── Inline step editor ────────────────────────────────────────────────────────

interface EditingStep { tcName: string; stepIndex: number; draft: PlanStep }

// ── Main component ────────────────────────────────────────────────────────────

interface Props { onGoToExecution: () => void; active?: boolean }

export default function TestDesignTab({ onGoToExecution, active }: Props) {
  const { C, isDark } = useTheme()
  const appId        = useAppSelector(s => s.app.appId)
  const appUrl       = useAppSelector(s => s.app.appUrl)
  const frameworkDir = useAppSelector(s => s.app.frameworkDir)

  const [rows,         setRows]         = useState<DesignRow[]>([])
  const [importOpen,   setImportOpen]   = useState(false)
  const [editingStep,  setEditingStep]  = useState<EditingStep | null>(null)

  // Re-crawl modal
  const [rcModal,    setRcModal]    = useState<{ tcName: string; url: string; intent: string; fwDir: string } | null>(null)
  const [recrawling, setRecrawling] = useState(false)

  const [planRun]      = usePlanRunMutation()
  const [savePlan]     = useSavePlanMutation()
  const [triggerCrawl] = useTriggerCrawlMutation()

  // Load saved test cases on tab activation
  const { data: apiTcs = [] } = useGetTestCasesQuery(appId, { skip: !appId || !active })

  useEffect(() => {
    if (!active || apiTcs.length === 0) return
    setRows(prev => {
      const existingMap = new Map(prev.map(r => [r.id, r]))
      const updated: DesignRow[] = []
      const seen = new Set<string>()
      for (const tc of apiTcs as TestCase[]) {
        seen.add(tc.tc_name)
        const existing = existingMap.get(tc.tc_name)
        if (existing) {
          // Always sync metadata from API (method_name, file_path, plan_steps)
          updated.push({
            ...existing,
            method_name: tc.method_name || existing.method_name,
            file_path:   tc.file_path   || existing.file_path,
            rawSteps:    existing.rawSteps.length > 0 ? existing.rawSteps : ((tc as any).raw_steps ?? []),
            planStatus:  existing.planStatus !== 'idle' ? existing.planStatus : (tc.plan_steps?.length ? 'done' : 'idle'),
            planResult:  existing.planResult ?? (tc.plan_steps?.length
              ? { steps: tc.plan_steps, parameters: tc.parameters ?? [], confidence: tc.confidence }
              : null),
          })
        } else {
          updated.push(makeApiRow(tc))
        }
      }
      // Keep any local-only rows (excel imports not yet saved)
      for (const r of prev) {
        if (!seen.has(r.id)) updated.push(r)
      }
      return updated
    })
  }, [active, apiTcs])

  // ── Row helpers ─────────────────────────────────────────────────────────────

  const updateRow = (id: string, patch: Partial<DesignRow>) =>
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))

  const effectiveSteps = (row: DesignRow): PlanStep[] => {
    if (row.stepEdits) return row.stepEdits
    return row.planResult?.steps ?? row.planResult?.plan_steps ?? []
  }

  // ── Import excel ─────────────────────────────────────────────────────────────

  const handleImport = (tcs: RawTestCase[]) => {
    setImportOpen(false)
    const existing = new Set(rows.map(r => r.id))
    const newRows = tcs
      .filter(tc => !existing.has(tc.tc_name ?? tc.name ?? ''))
      .map(makeExcelRow)
    const dupes = tcs.filter(tc => existing.has(tc.tc_name ?? tc.name ?? ''))
    if (dupes.length > 0) {
      message.info(`${dupes.length} duplicate(s) skipped`)
    }
    if (newRows.length > 0) setRows(prev => [...prev, ...newRows])
  }

  // ── Generate script per row ──────────────────────────────────────────────────

  const generateScript = async (row: DesignRow) => {
    updateRow(row.id, { planStatus: 'running' })
    try {
      await planRun({
        app_id: appId, tc_name: row.tc_name,
        description: row.description,
        java_dir: frameworkDir,
        steps: row.rawSteps,
      }).unwrap()

      await new Promise<void>((resolve, reject) => {
        const since = new Date().toISOString()
        const sse = new EventSource(`/dashboard/api/events/${encodeURIComponent(appId)}/stream?since=${encodeURIComponent(since)}`)
        const timer = setTimeout(() => { sse.close(); reject(new Error('Timed out')) }, 120000)
        sse.onmessage = (ev) => {
          try {
            const event = JSON.parse(ev.data)
            if (event.stage !== 'PLANNER_RESULT') return
            const payload = JSON.parse(event.message)
            if ((payload.tc_name ?? '') !== row.tc_name) return
            clearTimeout(timer); sse.close()
            const result: PlanResult = {
              steps:         (payload.steps ?? []) as PlanStep[],
              parameters:    (payload.parameters ?? []) as Parameter[],
              confidence:    payload.confidence,
              class_name:    payload.class_name,
              review_reason: payload.review_reason,
              eval:          payload.eval as PlanEval | undefined,
            }
            updateRow(row.id, { planStatus: 'done', planResult: result, stepEdits: null, expanded: true, expandedPanel: 'generated', method_name: payload.method_name ?? undefined })
            resolve()
          } catch { /* ignore */ }
        }
        sse.onerror = () => { clearTimeout(timer); sse.close(); reject(new Error('SSE error')) }
      })
    } catch (e: unknown) {
      const err = e as { data?: { detail?: string }; message?: string }
      updateRow(row.id, { planStatus: 'failed', planResult: null })
      message.error(`Planning failed: ${err?.data?.detail ?? err?.message ?? 'Unknown error'}`)
    }
  }

  // ── Save per row ─────────────────────────────────────────────────────────────

  const saveRow = async (row: DesignRow) => {
    if (row.planStatus !== 'done' || !row.planResult) return
    updateRow(row.id, { saveStatus: 'saving' })
    try {
      const result = row.stepEdits
        ? { ...row.planResult, steps: row.stepEdits }
        : row.planResult
      const resp = await savePlan({
        app_id: appId, java_dir: frameworkDir,
        test_cases: [{ tc_name: row.tc_name, result, raw_steps: row.rawSteps }],
      }).unwrap()
      // Try to get file_path from save response
      const saved = (resp as { saved?: { file_path?: string; method_name?: string }[] })?.saved?.[0]
      updateRow(row.id, { saveStatus: 'saved', file_path: saved?.file_path ?? frameworkDir, method_name: saved?.method_name ?? row.method_name })
      message.success(`Saved: ${row.tc_name}`)
    } catch (_) {
      updateRow(row.id, { saveStatus: 'error' })
      message.error('Save failed')
    }
  }

  // ── Re-crawl ─────────────────────────────────────────────────────────────────

  const openRecrawl = (row: DesignRow) => {
    const steps = effectiveSteps(row)
    setRcModal({ tcName: row.tc_name, url: appUrl, intent: deriveIntent(steps), fwDir: frameworkDir })
  }

  const confirmRecrawl = async () => {
    if (!rcModal) return
    setRecrawling(true)
    try {
      await triggerCrawl({
        app_id: appId, app_url: rcModal.url,
        build_id: 'recrawl-' + Date.now(),
        trigger_type: 'UPDATE',
        flow_name: rcModal.intent,
        headless: true,
      }).unwrap()

      await new Promise<void>(resolve => {
        const since = new Date().toISOString()
        const sse = new EventSource(`/dashboard/api/events/${encodeURIComponent(appId)}/stream?since=${encodeURIComponent(since)}`)
        const timer = setTimeout(() => { sse.close(); resolve() }, 300000)
        sse.onmessage = (ev) => {
          try {
            const event = JSON.parse(ev.data)
            if (['GENERATOR_COMPLETE', 'POM_COMPLETE'].includes(event.stage)) {
              clearTimeout(timer); sse.close(); resolve()
            }
          } catch { /* ignore */ }
        }
        sse.onerror = () => { clearTimeout(timer); sse.close(); resolve() }
      })
      setRcModal(null)
      message.success('Re-crawl complete')

      // Re-generate script for affected test case
      const row = rows.find(r => r.id === rcModal.tcName)
      if (row) await generateScript(row)
    } catch (e: unknown) {
      message.error(`Re-crawl failed: ${(e as Error)?.message ?? 'Unknown'}`)
    } finally {
      setRecrawling(false)
    }
  }

  // ── Step edit handlers ────────────────────────────────────────────────────────

  const startEdit = (row: DesignRow, stepIndex: number) => {
    const steps = effectiveSteps(row)
    setEditingStep({ tcName: row.id, stepIndex, draft: { ...steps[stepIndex] } })
  }

  const saveEdit = () => {
    if (!editingStep) return
    const row = rows.find(r => r.id === editingStep.tcName)
    if (!row) return
    const steps = [...effectiveSteps(row)]
    steps[editingStep.stepIndex] = editingStep.draft
    updateRow(row.id, { stepEdits: steps })
    setEditingStep(null)
  }

  const deleteStep = (row: DesignRow, stepIndex: number) => {
    const steps = effectiveSteps(row).filter((_, i) => i !== stepIndex)
    updateRow(row.id, { stepEdits: steps })
    if (editingStep?.tcName === row.id && editingStep.stepIndex === stepIndex) setEditingStep(null)
  }

  const addInteraction = (row: DesignRow, excelRef?: number) => {
    const steps = effectiveSteps(row)
    const newStep: PlanStep = { ...blankStep(steps.length + 1), excelStepRef: excelRef ?? 0 }
    const updated = [...steps, newStep]
    updateRow(row.id, { stepEdits: updated })
    setEditingStep({ tcName: row.id, stepIndex: updated.length - 1, draft: { ...newStep } })
  }

  const moveStep = (row: DesignRow, fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= effectiveSteps(row).length) return
    const steps = [...effectiveSteps(row)]
    const [moved] = steps.splice(fromIndex, 1)
    steps.splice(toIndex, 0, moved)
    updateRow(row.id, { stepEdits: steps })
    if (editingStep?.tcName === row.id && editingStep.stepIndex === fromIndex)
      setEditingStep(prev => prev ? { ...prev, stepIndex: toIndex } : null)
  }

  // ── Render inline step row ────────────────────────────────────────────────────

  const renderStepRow = (row: DesignRow, s: PlanStep, i: number, isLast: boolean) => {
    const isEditing = editingStep?.tcName === row.id && editingStep.stepIndex === i
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
            <Input size="small" placeholder="Description"
              value={d.humanReadable ?? ''} style={{ fontSize: 12 }}
              onChange={e => setEditingStep(prev => prev ? { ...prev, draft: { ...prev.draft, humanReadable: e.target.value } } : null)} />
            <Input size="small" placeholder="Page class (e.g. LoginPage)"
              value={d.pageClass ?? ''} style={{ ...MONO, fontSize: 11 }}
              onChange={e => setEditingStep(prev => prev ? { ...prev, draft: { ...prev.draft, pageClass: e.target.value } } : null)} />
            <Input size="small" placeholder="Method name"
              value={d.methodName ?? ''} style={{ ...MONO, fontSize: 11 }}
              onChange={e => setEditingStep(prev => prev ? { ...prev, draft: { ...prev.draft, methodName: e.target.value } } : null)} />
            <Input size="small" placeholder="Parameter name (blank if none)"
              value={d.parameterName ?? ''} style={{ ...MONO, fontSize: 11 }}
              onChange={e => setEditingStep(prev => prev ? { ...prev, draft: { ...prev.draft, parameterName: e.target.value, hasParameter: !!e.target.value } } : null)} />
          </div>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <Button size="small" icon={<CheckOutlined />} type="primary" onClick={saveEdit}>Save</Button>
            <Button size="small" icon={<CloseOutlined />} onClick={() => setEditingStep(null)}>Cancel</Button>
          </div>
        </div>
      )
    }

    return (
      <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '6px 0', borderBottom: !isLast ? `1px solid ${C.border}` : 'none' }}>
        <span style={{ minWidth: 22, color: C.muted, ...MONO, fontSize: 11, flexShrink: 0 }}>{i + 1}.</span>
        <span style={{ flex: 1, fontSize: 13, color: C.text }}>{desc}</span>
        {call && <span style={{ ...MONO, fontSize: 11, color: C.blue, whiteSpace: 'nowrap' }}>[{call}]</span>}
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          <Tooltip title="Edit step">
            <Button size="small" type="text" icon={<EditOutlined style={{ fontSize: 11, color: C.muted }} />} onClick={() => startEdit(row, i)} />
          </Tooltip>
          <Tooltip title="Delete step">
            <Button size="small" type="text" icon={<DeleteOutlined style={{ fontSize: 11, color: C.red }} />} onClick={() => deleteStep(row, i)} />
          </Tooltip>
        </div>
      </div>
    )
  }

  // ── Render expanded panels ────────────────────────────────────────────────────

  const renderExpanded = (row: DesignRow) => {
    const steps = effectiveSteps(row)
    const params = row.planResult?.parameters ?? row.planResult?.params ?? []
    const conf = row.planResult?.confidence ?? row.planResult?.score
    const needsReview = conf != null && Number(conf) < 0.75

    const TH: React.CSSProperties = {
      ...MONO, fontSize: 10, color: C.muted, textTransform: 'uppercase',
      letterSpacing: '0.06em', fontWeight: 600, padding: '6px 12px',
      background: C.surface2, borderBottom: `1px solid ${C.border}`,
      borderRight: `1px solid ${C.border}`, textAlign: 'left',
    }
    const TD: React.CSSProperties = {
      padding: '7px 12px', borderBottom: `1px solid ${C.border}`,
      borderRight: `1px solid ${C.border}`, verticalAlign: 'top', fontSize: 12,
    }

    const renderRawStepsContent = () => row.rawSteps.length === 0 ? (
      <span style={{ color: C.muted }}>
        {row.source === 'api' ? 'Loaded from automation registry.' : 'No steps imported.'}
      </span>
    ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {row.rawSteps.map((s, i) => (
          <div key={i} style={{ display: 'flex', gap: 6 }}>
            <span style={{ ...MONO, fontSize: 11, color: C.muted, minWidth: 18, flexShrink: 0 }}>{i + 1}.</span>
            <div>
              <div style={{ color: C.text, wordBreak: 'break-word' }}>{s.step ?? ''}</div>
              {s.expected && <div style={{ fontSize: 11, color: C.muted }}>↳ {s.expected}</div>}
            </div>
          </div>
        ))}
      </div>
    )

    return (
      <div style={{ borderTop: `1px solid ${C.border}`, background: C.surface }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '33%' }} />
            <col style={{ width: '34%' }} />
            <col style={{ width: '33%' }} />
          </colgroup>
          <thead>
            <tr>
              <th style={TH}>Test Steps</th>
              <th style={TH}>Application Actions</th>
              <th style={{ ...TH, borderRight: 'none' }}>Mapped Method</th>
            </tr>
          </thead>
          <tbody>
            {/* Not yet generated */}
            {(row.planStatus === 'idle' || row.planStatus === 'running' || row.planStatus === 'failed') && (
              <tr>
                <td style={{ ...TD, borderRight: `1px solid ${C.border}`, wordBreak: 'break-word' }}>
                  {renderRawStepsContent()}
                </td>
                <td style={TD} colSpan={2}>
                  {row.planStatus === 'idle'    && <span style={{ color: C.muted }}>Click Generate Script to produce steps.</span>}
                  {row.planStatus === 'running' && <span style={{ ...MONO, color: C.blue }}>● Planning…</span>}
                  {row.planStatus === 'failed'  && <span style={{ color: C.red }}>Planning failed. Try again.</span>}
                </td>
              </tr>
            )}

            {/* Group generated steps by excelStepRef — each raw step spans its generated steps */}
            {row.planStatus === 'done' && (() => {
              type Group = { ref: number; rawStep: RawTestCaseStep | undefined; items: { s: PlanStep; i: number }[] }
              const groups: Group[] = []
              const refMap = new Map<number, Group>()
              steps.forEach((s, i) => {
                const ref = Number(s.excelStepRef ?? 0)
                if (!refMap.has(ref)) {
                  const rawStep = ref > 0
                    ? row.rawSteps.find(es => Number(es.number) === ref)
                    : row.rawSteps[groups.length]
                  const g: Group = { ref, rawStep, items: [] }
                  groups.push(g)
                  refMap.set(ref, g)
                }
                refMap.get(ref)!.items.push({ s, i })
              })

              return groups.flatMap((g, gi) => {
                // +1 for the "Add action" row appended per group
                const spanCount = g.items.length + 1
                return [
                  ...g.items.map(({ s, i }, ji) => {
                    const isEditing = editingStep?.tcName === row.id && editingStep.stepIndex === i
                    const cls     = s.page_class ?? s.pageClass ?? ''
                    const method  = s.method ?? s.methodName ?? ''
                    const rawArgs = Array.isArray(s.params) ? s.params : Array.isArray(s.parameters) ? s.parameters : []
                    const pomCall = cls && method ? `${cls}.${method}(${rawArgs.join(', ')})` : method || '—'
                    const stepDesc = s.humanReadable ?? s.action ?? (cls && method ? pomCall : '—')

                    return (
                      <tr key={`${gi}-${ji}`}>
                        {/* Test Steps cell spans all action rows + add row */}
                        {ji === 0 && (
                          <td rowSpan={spanCount}
                              style={{ ...TD, borderRight: `1px solid ${C.border}`, verticalAlign: 'top', wordBreak: 'break-word' }}>
                            {g.rawStep ? (
                              <div style={{ display: 'flex', gap: 6 }}>
                                <span style={{ ...MONO, fontSize: 11, color: C.muted, minWidth: 18, flexShrink: 0 }}>
                                  {g.ref > 0 ? g.ref : gi + 1}.
                                </span>
                                <div>
                                  <div style={{ color: C.text }}>{g.rawStep.step ?? ''}</div>
                                  {g.rawStep.expected && <div style={{ fontSize: 11, color: C.muted }}>↳ {g.rawStep.expected}</div>}
                                </div>
                              </div>
                            ) : (
                              <span style={{ color: C.muted, fontSize: 11 }}>—</span>
                            )}
                          </td>
                        )}

                        {/* Application Actions cell */}
                        {isEditing && editingStep ? (
                          <td style={{ ...TD, wordBreak: 'break-word' }}>
                            <Input size="small" placeholder="Description"
                              value={editingStep.draft.humanReadable ?? ''} style={{ fontSize: 12, marginBottom: 4 }}
                              onChange={e => setEditingStep(prev => prev ? { ...prev, draft: { ...prev.draft, humanReadable: e.target.value } } : null)} />
                          </td>
                        ) : (
                          <td style={{ ...TD, wordBreak: 'break-word' }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                              <span style={{ flex: 1, color: C.text, fontSize: 12 }}>{stepDesc}</span>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flexShrink: 0 }}>
                                <Tooltip title="Move up">
                                  <Button size="small" type="text" style={{ height: 16, padding: '0 2px' }}
                                    icon={<CaretUpOutlined style={{ fontSize: 10, color: C.muted }} />}
                                    disabled={i === 0}
                                    onClick={() => moveStep(row, i, i - 1)} />
                                </Tooltip>
                                <Tooltip title="Move down">
                                  <Button size="small" type="text" style={{ height: 16, padding: '0 2px' }}
                                    icon={<CaretDownOutlined style={{ fontSize: 10, color: C.muted }} />}
                                    disabled={i === steps.length - 1}
                                    onClick={() => moveStep(row, i, i + 1)} />
                                </Tooltip>
                              </div>
                              <Tooltip title="Edit">
                                <Button size="small" type="text" icon={<EditOutlined style={{ fontSize: 11, color: C.muted }} />}
                                  onClick={() => startEdit(row, i)} />
                              </Tooltip>
                              <Tooltip title="Delete">
                                <Button size="small" type="text" icon={<DeleteOutlined style={{ fontSize: 11, color: C.red }} />}
                                  onClick={() => deleteStep(row, i)} />
                              </Tooltip>
                            </div>
                          </td>
                        )}

                        {/* Mapped Method cell */}
                        {isEditing && editingStep ? (
                          <td style={{ ...TD, borderRight: 'none', wordBreak: 'break-word' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <Input size="small" placeholder="Page class (e.g. LoginPage)"
                                value={editingStep.draft.pageClass ?? ''} style={{ ...MONO, fontSize: 11 }}
                                onChange={e => setEditingStep(prev => prev ? { ...prev, draft: { ...prev.draft, pageClass: e.target.value } } : null)} />
                              <Input size="small" placeholder="Method name"
                                value={editingStep.draft.methodName ?? ''} style={{ ...MONO, fontSize: 11 }}
                                onChange={e => setEditingStep(prev => prev ? { ...prev, draft: { ...prev.draft, methodName: e.target.value } } : null)} />
                              <Input size="small" placeholder="Parameter (blank if none)"
                                value={editingStep.draft.parameterName ?? ''} style={{ ...MONO, fontSize: 11 }}
                                onChange={e => setEditingStep(prev => prev ? { ...prev, draft: { ...prev.draft, parameterName: e.target.value, hasParameter: !!e.target.value } } : null)} />
                              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 2 }}>
                                <Button size="small" icon={<CheckOutlined />} type="primary" onClick={saveEdit}>Save</Button>
                                <Button size="small" icon={<CloseOutlined />} onClick={() => setEditingStep(null)}>Cancel</Button>
                              </div>
                            </div>
                          </td>
                        ) : (
                          <td style={{ ...TD, borderRight: 'none', wordBreak: 'break-word' }}>
                            <span style={{ ...MONO, fontSize: 11, color: C.blue }}>{pomCall}</span>
                          </td>
                        )}
                      </tr>
                    )
                  }),
                  // Add action row per group
                  <tr key={`${gi}-add`}>
                    <td colSpan={2} style={{ ...TD, borderRight: 'none', paddingTop: 4, paddingBottom: 4 }}>
                      <Button size="small" type="dashed" icon={<PlusOutlined />}
                        style={{ width: '100%', color: C.muted, borderColor: C.border, fontSize: 11 }}
                        onClick={() => addInteraction(row, g.ref || undefined)}>
                        Add application action
                      </Button>
                    </td>
                  </tr>,
                ]
              })
            })()}

            {/* Empty generated */}
            {row.planStatus === 'done' && steps.length === 0 && (
              <tr>
                <td style={{ ...TD, borderRight: `1px solid ${C.border}`, wordBreak: 'break-word' }}>
                  {renderRawStepsContent()}
                </td>
                <td style={TD} colSpan={2}><span style={{ color: C.muted }}>No steps generated.</span></td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Footer: params + eval */}
        {row.planStatus === 'done' && row.planResult && (params.length > 0 || needsReview || row.planResult.eval) && (
          <div style={{ padding: '10px 16px', borderTop: `1px solid ${C.border}` }}>
            {params.length > 0 && (
              <div style={{ fontSize: 12, color: C.muted, ...MONO, marginBottom: 8 }}>
                Parameters:{' '}
                {params.map((p: Parameter, i: number) => (
                  <span key={i}>{p.name ?? String(p)} <span style={{ color: C.muted }}>({p.type ?? 'String'})</span>{i < params.length - 1 ? '  ' : ''}</span>
                ))}
              </div>
            )}
            {needsReview && row.planResult.review_reason && (
              <div style={{ color: C.amber, fontSize: 12, marginBottom: 8, ...MONO }}>⚠ {row.planResult.review_reason}</div>
            )}
            {row.planResult.eval && (() => {
              const ev = row.planResult.eval!
              const gradeColor = ev.grade === 'A' ? C.green : ev.grade === 'B' ? C.blue : ev.grade === 'C' ? C.amber : C.red
              const dimLabels: [string, string][] = [
                ['methodValidity', 'Methods'], ['pathCoverage', 'Path'],
                ['paramCompleteness', 'Params'], ['stepCompleteness', 'Steps'],
              ]
              return (
                <div style={{ padding: '8px 12px', background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <span style={{ ...MONO, fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Plan Eval</span>
                    <span style={{ ...MONO, fontSize: 16, fontWeight: 700, color: gradeColor }}>{ev.grade}</span>
                    <span style={{ ...MONO, fontSize: 12, color: C.text }}>{ev.score}/100</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {dimLabels.map(([key, label]) => {
                      const dim = ev.dimensions?.[key]
                      if (!dim) return null
                      const dc = dim.score >= 90 ? C.green : dim.score >= 70 ? C.amber : C.red
                      return (
                        <div key={key} title={dim.notes} style={{ background: C.surface, border: `1px solid ${dc}44`, borderRadius: 4, padding: '3px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                          <span style={{ ...MONO, fontSize: 10, color: C.muted }}>{label}</span>
                          <span style={{ ...MONO, fontSize: 12, fontWeight: 600, color: dc }}>{Math.round(dim.score)}</span>
                        </div>
                      )
                    })}
                  </div>
                  {ev.flags?.map((f: string, i: number) => (
                    <div key={i} style={{ ...MONO, fontSize: 10, color: f.startsWith('ERROR') ? C.red : C.amber, marginTop: 2 }}>{f}</div>
                  ))}
                </div>
              )
            })()}
          </div>
        )}
      </div>
    )
  }

  // ── Render a single row ───────────────────────────────────────────────────────

  const renderRow = (row: DesignRow) => {
    const conf = row.planResult?.confidence ?? row.planResult?.score ?? row.apiConfidence
    const isAutomated = !!row.file_path
    const needsReview = conf != null && Number(conf) < 0.75

    return (
      <div key={row.id} style={{
        border: `1px solid ${needsReview && row.planStatus === 'done' ? C.amber : C.border}`,
        borderRadius: 8, marginBottom: 10, overflow: 'hidden',
      }}>
        {/* Row header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px',
          background: C.surface, cursor: 'pointer',
        }}
          onClick={() => updateRow(row.id, { expanded: !row.expanded })}
        >
          <span style={{ color: C.muted, fontSize: 12, flexShrink: 0 }}>
            {row.expanded ? <DownOutlined /> : <RightOutlined />}
          </span>
          <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
            <div style={{ ...MONO, fontSize: 13, fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {row.tc_name}
            </div>
            {row.method_name && (
              <div style={{ ...MONO, fontSize: 11, color: C.blue, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {row.method_name}()
              </div>
            )}
          </div>

          {/* Status badge */}
          <Tag
            color={isAutomated ? 'success' : 'warning'}
            style={{ ...MONO, fontSize: 10, flexShrink: 0 }}
          >
            {isAutomated ? 'Automated' : 'Not Automated'}
          </Tag>

          {/* Confidence */}
          {conf != null && <ConfBadge conf={conf} />}

          {/* Actions — visible only when expanded, on the right */}
          {row.expanded && (
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
              <Tooltip title="Generate test script">
                <Button size="small" icon={<CodeOutlined />}
                  loading={row.planStatus === 'running'}
                  disabled={row.planStatus === 'running'}
                  onClick={() => generateScript(row)}
                  style={{ ...MONO, fontSize: 11 }}>
                  Generate Script
                </Button>
              </Tooltip>
              <Tooltip title="Re-crawl with intent">
                <Button size="small" icon={<ReloadOutlined />}
                  onClick={() => openRecrawl(row)}
                  style={{ ...MONO, fontSize: 11 }}>
                  Re-crawl
                </Button>
              </Tooltip>
              <Tooltip title={row.planStatus !== 'done' ? 'Generate script first' : 'Save to framework'}>
                <Button size="small" icon={<SaveOutlined />}
                  disabled={row.planStatus !== 'done' || row.saveStatus === 'saving'}
                  loading={row.saveStatus === 'saving'}
                  onClick={() => saveRow(row)}
                  style={{
                    ...MONO, fontSize: 11,
                    color: row.saveStatus === 'saved' ? C.green : undefined,
                    borderColor: row.saveStatus === 'saved' ? C.green : undefined,
                  }}>
                  {row.saveStatus === 'saved' ? '✓ Saved' : 'Save'}
                </Button>
              </Tooltip>
            </div>
          )}
        </div>

        {/* Description + file path */}
        {(row.description || row.file_path) && (
          <div style={{ padding: '0 16px 10px', background: C.surface }}>
            {row.description && (
              <div style={{ fontSize: 12, color: C.muted }}>"{row.description}"</div>
            )}
            {row.file_path && (
              <div style={{ ...MONO, fontSize: 10, color: C.muted, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {row.file_path}
              </div>
            )}
          </div>
        )}

        {/* Expanded panels */}
        {row.expanded && renderExpanded(row)}
      </div>
    )
  }

  // ── Main render ───────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
        <span style={{ ...MONO, fontSize: 15, fontWeight: 600, color: C.text }}>Scenario Designer</span>
        <div style={{ flex: 1 }} />
        <Button type="primary" icon={<DownloadOutlined />} onClick={() => setImportOpen(true)}>
          Import Test Cases
        </Button>
      </div>

      {/* Row list */}
      {rows.length === 0 ? (
        <div style={{
          background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
          padding: '48px 24px', textAlign: 'center', color: C.muted, ...MONO, fontSize: 13,
        }}>
          {appId
            ? 'No test cases yet — click "Import Test Cases" to load from Excel, or saved test cases will appear here.'
            : 'Set an App ID in the App Cartographer tab first.'}
        </div>
      ) : (
        rows.map(renderRow)
      )}

      {/* Import modal */}
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onImport={handleImport} C={C} />

      {/* Re-crawl modal */}
      {rcModal && (
        <Modal
          open
          title={<span style={{ ...MONO, fontSize: 14 }}>Re-crawl with Guided Intent</span>}
          onCancel={() => setRcModal(null)}
          footer={[
            <Button key="cancel" onClick={() => setRcModal(null)}>Cancel</Button>,
            <Button key="confirm" type="primary" loading={recrawling} icon={<ReloadOutlined />} onClick={confirmRecrawl}>
              Start Re-crawl
            </Button>,
          ]}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '8px 0' }}>
            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4, ...MONO }}>App URL</div>
              <Input value={rcModal.url} placeholder="https://your-app.example.com"
                onChange={e => setRcModal(prev => prev ? { ...prev, url: e.target.value } : null)} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4, ...MONO }}>Framework Path</div>
              <Input value={rcModal.fwDir} placeholder="./shared/java"
                onChange={e => setRcModal(prev => prev ? { ...prev, fwDir: e.target.value } : null)} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4, ...MONO }}>
                Flow Intent <span style={{ fontWeight: 400, color: '#999' }}>(derived from steps — refine as needed)</span>
              </div>
              <Input.TextArea rows={4} value={rcModal.intent}
                onChange={e => setRcModal(prev => prev ? { ...prev, intent: e.target.value } : null)}
                style={{ ...MONO, fontSize: 12 }} />
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
