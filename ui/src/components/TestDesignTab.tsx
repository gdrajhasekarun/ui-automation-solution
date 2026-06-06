import React, { useState } from 'react'
import { Button, Input, Typography, Table, Checkbox, Tag } from 'antd'
import type { CheckboxChangeEvent } from 'antd/es/checkbox'
import type { TableColumnsType } from 'antd'
import { useTheme } from '../theme'
import { useAppSelector } from '../store'
import { useLoadExcelMutation, usePlanRunMutation, useSavePlanMutation } from '../store/api'
import type { RawTestCase, PlanResult, PlanStep } from '../types'

const { Text } = Typography

function esc(s: string) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function buildCodeHtml(steps: PlanStep[], muted: string) {
  if (!steps.length) return ''
  const cls = steps[0].page_class ?? 'Page'
  let out = `new <span style="color:#ffa657">${esc(cls)}</span><span style="color:${muted}">(</span>driver<span style="color:${muted}">)</span>`
  steps.forEach(s => {
    const method = s.method ?? s.action ?? ''
    const args   = (Array.isArray(s.params) ? s.params : Array.isArray(s.parameters) ? s.parameters : []).map(esc).join(', ')
    out += `\n    .<span style="color:#58A6FF">${esc(method)}</span><span style="color:${muted}">(</span>${args}<span style="color:${muted}">)</span>`
  })
  return out + ';'
}

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

interface Props { onGoToExecution: () => void }

export default function TestDesignTab({ onGoToExecution }: Props) {
  const { C, isDark } = useTheme()
  const appId        = useAppSelector(s => s.app.appId)
  const frameworkDir = useAppSelector(s => s.app.frameworkDir)

  const [step, setStep]                   = useState(1)
  const [excelPath, setExcelPath]         = useState('')
  const [loadError, setLoadError]         = useState('')
  const [tcs, setTcs]                     = useState<RawTestCase[]>([])
  const [selectedKeys, setSelectedKeys]   = useState<number[]>([])
  const [planned, setPlanned]             = useState<Record<string, Planned>>({})
  const [planRunning, setPlanRunning]     = useState(false)
  const [saveError, setSaveError]         = useState('')
  const [savedFiles, setSavedFiles]       = useState<{ cls: string; names: string[] }[]>([])

  const [loadExcel,  { isLoading: loadingExcel }] = useLoadExcelMutation()
  const [planRun]                                  = usePlanRunMutation()
  const [savePlan]                                 = useSavePlanMutation()

  const selectedTcs   = selectedKeys.map(i => tcs[i]).filter(Boolean)
  const selectedNames = selectedTcs.map(tc => tc.tc_name ?? tc.name ?? '')

  // ── Step 1 ────────────────────────────────────────────────────────────────
  const doLoadExcel = async () => {
    setLoadError('')
    if (!excelPath.trim()) { setLoadError('Please enter an Excel file path.'); return }
    try {
      const resp = await loadExcel({ excel_path: excelPath.trim() }).unwrap()
      setTcs(resp.test_cases ?? [])
      setSelectedKeys([])
    } catch (e: unknown) {
      const err = e as { data?: { detail?: string }; error?: string }
      setLoadError(err?.data?.detail ?? err?.error ?? 'Failed to load')
    }
  }

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
  ]

  // ── Step 2 ────────────────────────────────────────────────────────────────
  const runPlanner = async () => {
    setPlanRunning(true)
    for (const tc of selectedTcs) {
      const name = tc.tc_name ?? tc.name ?? ''
      setPlanned(prev => ({ ...prev, [name]: { status: 'in_progress', result: null, error: null } }))
      try {
        const result = await planRun({ app_id: appId, tc_name: name, description: tc.description ?? '', java_dir: frameworkDir }).unwrap() as PlanResult
        setPlanned(prev => ({ ...prev, [name]: { status: 'complete', result, error: null } }))
      } catch (e: unknown) {
        const err = e as { data?: { detail?: string }; error?: string }
        setPlanned(prev => ({ ...prev, [name]: { status: 'failed', result: null, error: err?.data?.detail ?? err?.error ?? 'Failed' } }))
      }
    }
    setPlanRunning(false)
  }

  const canSave = selectedNames.length > 0 && selectedNames.every(name => {
    const p = planned[name]
    if (!p || p.status !== 'complete') return false
    const conf = p.result?.confidence ?? p.result?.score
    return conf == null || Number(conf) >= 0.75
  })

  // ── Step 3 ────────────────────────────────────────────────────────────────
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
          return { tc_name: name, result: planned[name]?.result ?? null }
        }),
      }).unwrap()
    } catch (_) {}
    setStep(3)
  }

  return (
    <div>
      <StepIndicator step={step} />

      {/* ── Step 1 ── */}
      {step === 1 && (
        <div>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '16px 20px', marginBottom: 16 }}>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 16 }}>Load Test Cases</div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Excel Path</div>
                <Input value={excelPath} onChange={e => setExcelPath(e.target.value)} placeholder="./test-cases.xlsx" style={{ width: 320 }} onPressEnter={doLoadExcel} />
              </div>
              <Button type="primary" loading={loadingExcel} onClick={doLoadExcel}>Load Test Cases</Button>
            </div>
            {loadError && <div style={{ color: C.red, fontSize: 12, fontFamily: "'IBM Plex Mono',monospace", marginTop: 8 }}>{loadError}</div>}
          </div>

          {tcs.length > 0 && (
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '16px 20px' }}>
              <Table<RawTestCase & { _i: number }>
                dataSource={tcs.map((tc, i) => ({ ...tc, _i: i, key: i }))}
                columns={step1Cols} pagination={false} size="small" scroll={{ y: 300 }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                <Button type="primary" disabled={selectedKeys.length === 0} onClick={() => { setPlanned({}); setStep(2) }}>Next →</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Step 2 ── */}
      {step === 2 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 15, fontWeight: 600, color: C.text }}>Plan Test Cases</div>
            <div style={{ flex: 1 }} />
            <Button type="primary" loading={planRunning} onClick={runPlanner}>Run Planner</Button>
          </div>

          {selectedTcs.map(tc => {
            const name = tc.tc_name ?? tc.name ?? ''
            const p    = planned[name]
            const status  = p?.status ?? 'not_started'
            const result  = p?.result ?? null
            const conf    = result?.confidence ?? result?.score
            const needsReview = conf != null && Number(conf) < 0.75
            const steps: PlanStep[] = result?.steps ?? result?.plan_steps ?? []
            const params = result?.parameters ?? result?.params ?? []
            return (
              <div key={name} style={{ background: C.surface, border: `1px solid ${needsReview ? C.amber : C.border}`, borderRadius: 8, marginBottom: 14, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 10px' }}>
                  <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, fontWeight: 600, color: C.text }}>{name}</span>
                  <ConfBadge conf={conf} />
                </div>
                <div style={{ fontSize: 12, color: C.muted, padding: '0 16px 10px' }}>"{tc.description ?? ''}"</div>
                <div style={{ borderTop: `1px solid ${C.border}`, padding: '14px 16px' }}>
                  {status === 'not_started' && <span style={{ color: C.muted, fontSize: 12 }}>Not started — click Run Planner</span>}
                  {status === 'in_progress' && <span style={{ color: C.blue, fontSize: 12, fontFamily: "'IBM Plex Mono',monospace", animation: 'kb-pulse 1.2s ease-in-out infinite', display: 'inline-block' }}>● Planning…</span>}
                  {status === 'failed'      && <span style={{ color: C.red, fontSize: 12, fontFamily: "'IBM Plex Mono',monospace" }}>{p?.error}</span>}
                  {status === 'complete' && result && (
                    <>
                      <div style={{ color: C.green, fontSize: 12, marginBottom: 10 }}>✓ Planned</div>
                      {steps.length > 0 && (
                        <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 6, fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, lineHeight: 1.7, overflowX: 'auto', padding: '12px 16px', whiteSpace: 'pre', marginBottom: 10, color: C.text }}
                          dangerouslySetInnerHTML={{ __html: buildCodeHtml(steps, C.muted) }} />
                      )}
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
                    </>
                  )}
                </div>
              </div>
            )
          })}

          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <Button onClick={() => setStep(1)}>← Back</Button>
            <div style={{ flex: 1 }} />
            <Button type="primary" disabled={!canSave} onClick={doSave} style={{ background: canSave ? C.green : undefined, borderColor: canSave ? C.green : undefined }}>Save →</Button>
          </div>
        </div>
      )}

      {/* ── Step 3 ── */}
      {step === 3 && (
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
            <Button onClick={() => setStep(2)}>← Back to Plan</Button>
            <div style={{ flex: 1 }} />
            <Button type="primary" onClick={onGoToExecution}>Go to Execution →</Button>
          </div>
        </div>
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
