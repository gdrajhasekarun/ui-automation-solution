import React, { useState, useEffect, useRef } from 'react'
import { Button, Input, Typography, Table, Checkbox, Drawer, Tag } from 'antd'
import type { CheckboxChangeEvent } from 'antd/es/checkbox'
import type { TableColumnsType } from 'antd'
import { useTheme } from '../theme'
import { useAppSelector } from '../store'
import {
  useGetTestCasesQuery,
  useGetTestCaseParamsQuery,
  useExecuteRunMutation,
  useGetRunResultsQuery,
  useGetRunsQuery,
  useGetEventsQuery,
} from '../store/api'
import type { TestCase, Parameter, TestResult, TestRun, UiEvent } from '../types'

const { Text } = Typography

function fmtTime(ts?: string) {
  if (!ts) return new Date().toTimeString().slice(0, 8)
  try { return new Date(ts).toTimeString().slice(0, 8) } catch { return ts.slice(11, 19) }
}
function fmtDateTime(ts?: string) {
  if (!ts) return ''
  try { const d = new Date(ts); return d.toLocaleDateString() + ' ' + d.toTimeString().slice(0, 5) } catch { return String(ts) }
}

function StatusBadge({ status }: { status: string }) {
  const s = (status ?? '').toUpperCase()
  if (s === 'READY')        return <Tag color="success" style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11 }}>READY</Tag>
  if (s === 'NEEDS_REVIEW') return <Tag color="warning" style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11 }}>NEEDS REVIEW</Tag>
  if (s === 'PLANNED')      return <Tag            style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11 }}>PLANNED</Tag>
  if (s === 'PASSED')       return <Tag color="success" style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11 }}>✓ PASSED</Tag>
  if (s === 'FAILED')       return <Tag color="error"   style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11 }}>✗ FAILED</Tag>
  return <Tag style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11 }}>{s || 'UNKNOWN'}</Tag>
}

function FailureCell({ msg }: { msg?: string }) {
  const { C } = useTheme()
  const [expanded, setExpanded] = useState(false)
  if (!msg) return <span style={{ color: C.muted }}>—</span>
  return (
    <span>
      <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: C.red }}>
        {expanded ? msg : msg.slice(0, 80)}
      </span>
      {msg.length > 80 && (
        <button onClick={() => setExpanded(e => !e)} style={{ background: 'none', border: 'none', color: C.blue, cursor: 'pointer', fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, padding: '0 4px' }}>
          {expanded ? '▲ less' : '▼ more'}
        </button>
      )}
    </span>
  )
}

// ── Param form for a single TC — fetches its own params via RTK ───────────────
function ParamForm({ tc, formValues, setFormValues }: {
  tc: TestCase
  formValues: Record<string, string>
  setFormValues: React.Dispatch<React.SetStateAction<Record<string, string>>>
}) {
  const { C } = useTheme()
  const { data: params = [] } = useGetTestCaseParamsQuery(tc.tc_id)
  if (!params.length) return (
    <div key={tc.tc_id} style={{ marginBottom: 12 }}>
      <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 6 }}>{tc.tc_name}</div>
      <div style={{ color: C.muted, fontSize: 12 }}>No parameters required.</div>
    </div>
  )
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 8 }}>{tc.tc_name}</div>
      {params.map((p: Parameter) => (
        <div key={p.name} style={{ marginBottom: 12 }}>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{p.name}</div>
          <Input placeholder={`(${p.type ?? 'String'})`} value={formValues[`${tc.tc_id}__${p.name}`] ?? ''}
            onChange={e => setFormValues(prev => ({ ...prev, [`${tc.tc_id}__${p.name}`]: e.target.value }))}
            style={{ maxWidth: 380 }} />
        </div>
      ))}
    </div>
  )
}

// ── Results polling sub-component ────��────────────────────────────────────────
function ResultsPoller({ runId, onDone }: { runId: string; onDone: (data: { results: TestResult[]; totalMs: number }) => void }) {
  const { data, isSuccess } = useGetRunResultsQuery(runId, {
    pollingInterval: 2000,
    skip: !runId,
  })
  const calledRef = useRef(false)
  useEffect(() => {
    if (!isSuccess || calledRef.current) return
    const results: TestResult[] = data?.results ?? data?.test_results ?? []
    if (results.length || data?.status === 'COMPLETE') {
      calledRef.current = true
      onDone({ results, totalMs: data?.total_duration ?? data?.duration_ms ?? results.reduce((a, r) => a + (r.duration_ms ?? r.duration ?? 0), 0) })
    }
  }, [isSuccess, data, onDone])
  return null
}

type ExecView = 'table' | 'data-entry' | 'running' | 'results'

export default function ExecutionTab() {
  const { C, isDark } = useTheme()
  const appId        = useAppSelector(s => s.app.appId)
  const frameworkDir = useAppSelector(s => s.app.frameworkDir)

  const [selectedIds, setSelectedIds]     = useState<string[]>([])
  const [view, setView]                   = useState<ExecView>('table')
  const [formValues, setFormValues]       = useState<Record<string, string>>({})
  const [entryError, setEntryError]       = useState('')
  const [runId, setRunId]                 = useState<string | null>(null)
  const [pollingRunId, setPollingRunId]   = useState<string | null>(null)
  const [results, setResults]             = useState<TestResult[]>([])
  const [totalMs, setTotalMs]             = useState(0)
  const [drawerOpen, setDrawerOpen]       = useState(false)
  const [openAccordion, setOpenAccordion] = useState<string | null>(null)
  const logSeenRef = useRef<Set<string>>(new Set())
  const [liveLog, setLiveLog]             = useState<string[]>([])

  // Queries
  const { data: tcs = [] } = useGetTestCasesQuery(appId, { pollingInterval: view === 'running' ? 5000 : 0, skip: !appId })
  const { data: runs = [] } = useGetRunsQuery(appId, { skip: !drawerOpen || !appId })
  const { data: execEvents = [] } = useGetEventsQuery({ appId, limit: 100 }, {
    pollingInterval: view === 'running' ? 1000 : 0,
    skip: view !== 'running' || !appId,
  })

  const [executeRun, { isLoading: executing }] = useExecuteRunMutation()

  const readyTcs   = tcs.filter(tc => (tc.status ?? '').toUpperCase() !== 'NEEDS_REVIEW')
  const selected   = tcs.filter(tc => selectedIds.includes(tc.tc_id))

  // Pump live log from RTK exec events
  useEffect(() => {
    if (view !== 'running') return
    const newEvs = (execEvents as UiEvent[]).filter(ev => {
      if ((ev.stage ?? '').toUpperCase() !== 'EXECUTE') return false
      const id = ev.event_id ?? ev.id ?? (String(ev.created_at ?? ev.timestamp ?? '') + ev.message)
      if (logSeenRef.current.has(id)) return false
      logSeenRef.current.add(id); return true
    })
    if (newEvs.length) {
      setLiveLog(prev => [...newEvs.map(ev => `[${fmtTime(ev.created_at ?? ev.timestamp)}] ${ev.message}`), ...prev].slice(0, 100))
    }
  }, [execEvents, view])

  const handleRunSelected = () => {
    setFormValues({}); setEntryError(''); setView('data-entry')
  }

  const handleExecute = async () => {
    setEntryError('')
    const rid = 'run-' + Date.now()
    setRunId(rid); setLiveLog([]); logSeenRef.current.clear(); setView('running')
    const testData = selected.map(tc => {
      const values: Record<string, string> = {}
      Object.keys(formValues).filter(k => k.startsWith(tc.tc_id + '__')).forEach(k => {
        values[k.slice(tc.tc_id.length + 2)] = formValues[k]
      })
      return { tc_name: tc.tc_name, values }
    })
    try {
      await executeRun({
        app_id: appId, run_id: rid, java_dir: frameworkDir,
        selected_tests: selected.map(tc => tc.method_name || tc.tc_name),
        test_data: testData,
      }).unwrap()
      setPollingRunId(rid)
    } catch (e: unknown) {
      const err = e as { data?: { detail?: string }; error?: string }
      setView('data-entry')
      setEntryError(err?.data?.detail ?? err?.error ?? 'Execute failed')
    }
  }

  const handleResultsDone = ({ results: r, totalMs: t }: { results: TestResult[]; totalMs: number }) => {
    setResults(r); setTotalMs(t); setPollingRunId(null); setView('results')
  }

  const passed  = results.filter(r => (r.status ?? '').toUpperCase() === 'PASSED').length
  const failed  = results.filter(r => (r.status ?? '').toUpperCase() === 'FAILED').length
  const skipped = results.filter(r => (r.status ?? '').toUpperCase() === 'SKIPPED').length

  const columns: TableColumnsType<TestCase> = [
    {
      title: (
        <Checkbox
          checked={readyTcs.length > 0 && readyTcs.every(tc => selectedIds.includes(tc.tc_id))}
          indeterminate={readyTcs.some(tc => selectedIds.includes(tc.tc_id)) && !readyTcs.every(tc => selectedIds.includes(tc.tc_id))}
          onChange={(e: CheckboxChangeEvent) => setSelectedIds(e.target.checked ? readyTcs.map(tc => tc.tc_id) : [])}
        />
      ),
      width: 40,
      render: (_: unknown, row: TestCase) => {
        const nr = (row.status ?? '').toUpperCase() === 'NEEDS_REVIEW'
        return <Checkbox disabled={nr} checked={selectedIds.includes(row.tc_id)}
          onChange={(e: CheckboxChangeEvent) => setSelectedIds(prev => e.target.checked ? [...prev, row.tc_id] : prev.filter(id => id !== row.tc_id))} />
      },
    },
    {
      title: 'Test Case Name',
      render: (_: unknown, row: TestCase) => {
        const nr = (row.status ?? '').toUpperCase() === 'NEEDS_REVIEW'
        return <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: nr ? C.muted : C.text }}>
          {row.tc_name}
          {nr && <span style={{ color: C.amber, fontSize: 11, marginLeft: 8 }}>⚠ Review required</span>}
        </span>
      },
    },
    { title: 'Status',     width: 140, render: (_: unknown, row: TestCase) => <StatusBadge status={row.status} /> },
    { title: 'Confidence', width: 100, render: (_: unknown, row: TestCase) => {
      const c = row.confidence
      if (c == null) return <span style={{ color: C.muted }}>—</span>
      return <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: c >= 0.75 ? C.green : C.amber }}>{(c * 100).toFixed(0)}%</span>
    }},
    { title: 'Last Run', width: 140, render: (_: unknown, row: TestCase) =>
      <span style={{ fontSize: 12, color: C.muted }}>{row.last_run ? fmtDateTime(row.last_run) : '—'}</span>
    },
  ]

  const resultColumns: TableColumnsType<TestResult> = [
    { title: 'Test Case', render: (_: unknown, r: TestResult) => <Text style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12 }}>{r.tc_name ?? r.test_name}</Text> },
    { title: 'Status', width: 110, render: (_: unknown, r: TestResult) => <StatusBadge status={r.status} /> },
    { title: 'Duration', width: 100, render: (_: unknown, r: TestResult) => <Text style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: C.muted }}>{(r.duration_ms ?? r.duration) != null ? `${r.duration_ms ?? r.duration}ms` : '—'}</Text> },
    { title: 'Failure', render: (_: unknown, r: TestResult) => <FailureCell msg={r.failure_msg ?? r.failure ?? r.error} /> },
  ]

  return (
    <div>
      {pollingRunId && <ResultsPoller runId={pollingRunId} onDone={handleResultsDone} />}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 15, fontWeight: 600, color: C.text }}>Test Cases</span>
        <Button onClick={() => setDrawerOpen(true)}>Execution History ↗</Button>
      </div>

      {/* Table */}
      {view === 'table' && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '16px 20px' }}>
          <Table<TestCase>
            dataSource={tcs.map(tc => ({ ...tc, key: tc.tc_id }))}
            columns={columns} pagination={false} size="small" scroll={{ y: 340 }}
            rowClassName={row => (row.status ?? '').toUpperCase() === 'NEEDS_REVIEW' ? 'exec-muted-row' : ''}
            locale={{ emptyText: <Text style={{ color: C.muted }}>No test cases yet — plan some in Test Design</Text> }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <Button type="primary" disabled={selectedIds.length === 0} onClick={handleRunSelected}>▶ Run Selected</Button>
          </div>
        </div>
      )}

      {/* Data entry */}
      {view === 'data-entry' && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '16px 20px' }}>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 16 }}>Enter Test Data</div>
          {selected.map(tc => (
            <ParamForm key={tc.tc_id} tc={tc} formValues={formValues} setFormValues={setFormValues} />
          ))}
          {entryError && <div style={{ color: C.red, fontSize: 12, fontFamily: "'IBM Plex Mono',monospace", marginBottom: 8 }}>{entryError}</div>}
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <Button onClick={() => setView('table')}>← Cancel</Button>
            <div style={{ flex: 1 }} />
            <Button type="primary" loading={executing} onClick={handleExecute}>▶ Execute</Button>
          </div>
        </div>
      )}

      {/* Running */}
      {view === 'running' && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '16px 20px' }}>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, marginBottom: 8, color: C.text }}>
            Running {selected.length} test case{selected.length !== 1 ? 's' : ''}…
          </div>
          <div style={{ background: C.border, borderRadius: 4, height: 4, overflow: 'hidden', margin: '12px 0' }}>
            <div style={{ background: C.blue, height: '100%', width: '40%', animation: 'exec-indeterminate 1.4s infinite ease-in-out' }} />
          </div>
          <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 6, fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, maxHeight: 200, overflowY: 'auto', padding: '10px 14px', marginTop: 10 }}>
            {liveLog.length === 0
              ? <span style={{ color: C.muted }}>Waiting for output…</span>
              : liveLog.map((line, i) => <div key={i} style={{ color: C.muted, marginBottom: 3 }}>{line}</div>)
            }
          </div>
        </div>
      )}

      {/* Results */}
      {view === 'results' && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '16px 20px' }}>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 14 }}>Run Results</div>
          <div style={{ display: 'flex', gap: 20, fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, marginBottom: 16, flexWrap: 'wrap' }}>
            <span style={{ color: C.green }}>✓ {passed} Passed</span>
            <span style={{ color: C.red }}>✗ {failed} Failed</span>
            <span style={{ color: C.muted }}>◌ {skipped} Skipped</span>
            <span style={{ color: C.muted }}>⏱ {totalMs}ms</span>
          </div>
          <Table<TestResult>
            dataSource={results.map((r, i) => ({ ...r, key: r.result_id ?? String(i) }))}
            columns={resultColumns} pagination={false} size="small" scroll={{ y: 280 }}
          />
          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <Button onClick={() => { setSelectedIds([]); setView('table') }}>← New Selection</Button>
            <div style={{ flex: 1 }} />
            <Button type="primary" onClick={() => setView('data-entry')}>▶ Run Again</Button>
          </div>
        </div>
      )}

      {/* History Drawer */}
      <Drawer
        title={<span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 15, color: C.text }}>Execution History</span>}
        placement="right" width={480} open={drawerOpen} onClose={() => setDrawerOpen(false)}
        styles={{ header: { background: C.surface, borderBottom: `1px solid ${C.border}` }, body: { background: C.surface, padding: '16px 20px' }, mask: { background: 'rgba(0,0,0,0.6)' } }}
      >
        {runs.length === 0
          ? <span style={{ color: C.muted, fontSize: 13 }}>No runs yet.</span>
          : (runs as TestRun[]).map((run, i) => {
            const rr     = run.results ?? run.test_results ?? []
            const p      = rr.filter(r => (r.status ?? '').toUpperCase() === 'PASSED').length
            const f      = rr.filter(r => (r.status ?? '').toUpperCase() === 'FAILED').length
            const total  = run.total_duration ?? run.duration_ms ?? 0
            const accId  = run.run_id ?? run.id ?? String(i)
            const isOpen = openAccordion === accId
            return (
              <div key={accId} style={{ border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 12, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', background: C.surface2, padding: '12px 14px', gap: 10 }}>
                  <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, flex: 1 }}>
                    <div style={{ fontWeight: 600, color: C.text }}>Run #{i + 1}</div>
                    <div style={{ color: C.muted, marginTop: 3 }}>{fmtDateTime(run.created_at ?? run.started_at)}</div>
                    <div style={{ color: C.muted, marginTop: 3 }}>
                      {rr.length} tests ·{' '}
                      <span style={{ color: C.green }}>✓ {p} passed</span> ·{' '}
                      <span style={{ color: C.red }}>✗ {f} failed</span>
                      <br />Total: {total}ms
                    </div>
                  </div>
                  <button onClick={() => setOpenAccordion(isOpen ? null : accId)}
                    style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 4, color: C.muted, cursor: 'pointer', fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, height: 28, padding: '0 10px', flexShrink: 0 }}>
                    {isOpen ? 'Hide ▲' : 'View ▼'}
                  </button>
                </div>
                {isOpen && (
                  <div style={{ padding: '12px 14px' }}>
                    {rr.length === 0 ? <span style={{ color: C.muted, fontSize: 12 }}>No detail.</span>
                      : <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                          <thead><tr>{['Test Case','Status','Duration'].map(h =>
                            <th key={h} style={{ background: C.surface2, border: `1px solid ${C.border}`, fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: C.muted, padding: '6px 10px', textAlign: 'left', textTransform: 'uppercase' }}>{h}</th>
                          )}</tr></thead>
                          <tbody>{rr.map((r, ri) =>
                            <tr key={ri}>
                              <td style={{ border: `1px solid ${C.border}`, padding: '7px 10px', fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: C.text }}>{r.tc_name ?? r.test_name}</td>
                              <td style={{ border: `1px solid ${C.border}`, padding: '7px 10px' }}><StatusBadge status={r.status} /></td>
                              <td style={{ border: `1px solid ${C.border}`, padding: '7px 10px', fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: C.muted }}>{(r.duration_ms ?? r.duration) != null ? `${r.duration_ms ?? r.duration}ms` : '—'}</td>
                            </tr>
                          )}</tbody>
                        </table>
                    }
                  </div>
                )}
              </div>
            )
          })
        }
      </Drawer>

      <style>{`
        @keyframes exec-indeterminate { 0%{transform:translateX(-250%)} 100%{transform:translateX(600%)} }
        .exec-muted-row { opacity: 0.55; }
        .ant-table-wrapper .ant-table { background: transparent !important; }
        .ant-table-wrapper .ant-table-thead > tr > th { background: ${C.surface2} !important; color: ${C.muted} !important; font-family: 'IBM Plex Mono',monospace; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
        .ant-table-wrapper .ant-table-tbody > tr > td { border-color: ${C.border} !important; }
        .ant-table-wrapper .ant-table-tbody > tr:hover > td { background: ${isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)'} !important; }
        .ant-drawer-close { color: ${C.muted} !important; }
      `}</style>
    </div>
  )
}
