import React, { useState, useRef, useCallback, useEffect } from 'react'
import { Button, Drawer, Input, Modal, Table, Checkbox, Tag } from 'antd'
import type { CheckboxChangeEvent } from 'antd/es/checkbox'
import type { TableColumnsType } from 'antd'
import { useTheme } from '../theme'
import { useAppSelector } from '../store'
import {
  useGetTestCasesQuery,
  useExportTemplateMutation,
  useImportTestDataMutation,
  useGetExecutorResultsQuery,
} from '../store/api'
import type { TestCase, TestResult, ExecutorRunResult, ExecutorTestResult, ImportDataResp } from '../types'

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtDateTime(ts?: string) {
  if (!ts) return ''
  try {
    const d = new Date(ts)
    return d.toLocaleDateString() + ' ' + d.toTimeString().slice(0, 5)
  } catch { return String(ts) }
}

function StatusBadge({ status }: { status: string }) {
  const s = (status ?? '').toUpperCase()
  const mono = { fontFamily: "'IBM Plex Mono',monospace", fontSize: 11 }
  if (s === 'READY')        return <Tag color="success" style={mono}>READY</Tag>
  if (s === 'NEEDS_REVIEW') return <Tag color="warning" style={mono}>NEEDS REVIEW</Tag>
  if (s === 'PLANNED')      return <Tag style={mono}>PLANNED</Tag>
  if (s === 'PASSED' || s === 'PASS') return <Tag color="success" style={mono}>✓ PASSED</Tag>
  if (s === 'FAILED' || s === 'FAIL') return <Tag color="error"   style={mono}>✗ FAILED</Tag>
  if (s === 'SKIPPED' || s === 'SKIP') return <Tag color="default" style={mono}>◌ SKIPPED</Tag>
  return <Tag style={mono}>{s || 'UNKNOWN'}</Tag>
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
        <button onClick={() => setExpanded(e => !e)}
          style={{ background: 'none', border: 'none', color: C.blue, cursor: 'pointer', fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, padding: '0 4px' }}>
          {expanded ? '▲ less' : '▼ more'}
        </button>
      )}
    </span>
  )
}

// ── sub-tab toggle ────────────────────────────────────────────────────────────

function SubTabToggle({ active, onChange, C }: {
  active: 'results' | 'logs'
  onChange: (t: 'results' | 'logs') => void
  C: ReturnType<typeof useTheme>['C']
}) {
  const btn = (label: string, key: 'results' | 'logs') => (
    <button key={key} onClick={() => onChange(key)} style={{
      background: active === key ? C.blue : 'transparent',
      border: `1px solid ${active === key ? C.blue : C.border}`,
      borderRadius: 4,
      color: active === key ? '#fff' : C.muted,
      cursor: 'pointer',
      fontFamily: "'IBM Plex Mono',monospace",
      fontSize: 12,
      padding: '4px 14px',
    }}>{label}</button>
  )
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {btn('Test Case Results', 'results')}
      {btn('Live Logs', 'logs')}
    </div>
  )
}

// ── import modal ──────────────────────────────────────────────────────────────

function ImportModal({ open, onClose, onImported, suiteMethodNames, appId, javaDir, C, isDark }: {
  open: boolean
  onClose: () => void
  onImported: (result: ImportDataResp) => void
  suiteMethodNames: string[]
  appId: string
  javaDir: string
  C: ReturnType<typeof useTheme>['C']
  isDark: boolean
}) {
  const [file, setFile]       = useState<File | null>(null)
  const [result, setResult]   = useState<ImportDataResp | null>(null)
  const [error, setError]     = useState('')
  const fileRef               = useRef<HTMLInputElement>(null)

  // Clear all state every time the modal opens so the user starts fresh
  useEffect(() => {
    if (open) {
      setFile(null); setResult(null); setError('')
      if (fileRef.current) fileRef.current.value = ''
    }
  }, [open])

  const [exportTemplate, { isLoading: exporting }] = useExportTemplateMutation()
  const [importTestData, { isLoading: importing }] = useImportTestDataMutation()

  const handleExport = async () => {
    setError('')
    try {
      const blob = await exportTemplate({ app_id: appId, method_names: suiteMethodNames }).unwrap()
      const url = URL.createObjectURL(blob as Blob)
      const a = document.createElement('a')
      a.href = url; a.download = `${appId}-test-data-template.xlsx`; a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError('Export failed. Is the executor running?')
    }
  }

  const handleImport = async () => {
    if (!file) { setError('Please select a file first.'); return }
    setError('')
    try {
      const resp = await importTestData({ appId, file, javaDir }).unwrap()
      setResult(resp)
      onImported(resp)
    } catch (e) {
      setError('Import failed. Check that the file matches the template format.')
    }
  }

  const handleClose = () => {
    setFile(null); setResult(null); setError('')
    onClose()
  }

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      footer={null}
      title={<span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 15, color: C.text }}>Import Test Data</span>}
      styles={{
        content:  { background: C.surface, border: `1px solid ${C.border}` },
        header:   { background: C.surface, borderBottom: `1px solid ${C.border}` },
        mask:     { background: isDark ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.45)' },
      }}
    >
      {/* Step 1 */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
          Step 1 — Download template
        </div>
        <Button loading={exporting} onClick={handleExport} icon={<span>↓</span>}>
          Export Test Data Template
        </Button>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>
          Template includes headers for: {suiteMethodNames.join(', ')}
        </div>
      </div>

      {/* Step 2 */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
          Step 2 — Fill and re-upload
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input ref={fileRef} type="file" accept=".xlsx" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) setFile(f) }} />
          <Button onClick={() => fileRef.current?.click()}>Browse…</Button>
          <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: file ? C.text : C.muted }}>
            {file ? file.name : 'No file selected'}
          </span>
        </div>
      </div>

      {/* Import result */}
      {result && (
        <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 6, padding: '10px 14px', marginBottom: 16 }}>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: C.green, marginBottom: 4 }}>✓ Import successful</div>
          {Object.entries(result.imported).map(([method, rows]) => (
            <div key={method} style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: C.muted }}>
              {method}: {rows} row{rows !== 1 ? 's' : ''}
            </div>
          ))}
        </div>
      )}

      {error && (
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: C.red, marginBottom: 12 }}>{error}</div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <Button onClick={handleClose}>Cancel</Button>
        <Button type="primary" loading={importing} disabled={!file || !!result} onClick={handleImport}>
          Import ▶
        </Button>
      </div>
    </Modal>
  )
}

// ── main component ────────────────────────────────────────────────────────────

type ExecView = 'table' | 'suite' | 'running'

export default function ExecutionTab() {
  const { C, isDark } = useTheme()
  const appId        = useAppSelector(s => s.app.appId)
  const frameworkDir = useAppSelector(s => s.app.frameworkDir)

  // selection / suite state
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [view, setView]               = useState<ExecView>('table')

  // import state
  const [importOpen, setImportOpen]       = useState(false)
  const [importResult, setImportResult]   = useState<ImportDataResp | null>(null)

  // run state
  const [runSubTab, setRunSubTab]     = useState<'results' | 'logs'>('logs')
  const [liveLog, setLiveLog]         = useState<string[]>([])
  const [runResults, setRunResults]   = useState<ExecutorTestResult[]>([])
  const [runDone, setRunDone]         = useState(false)
  const [running, setRunning]         = useState(false)
  const [runError, setRunError]       = useState('')
  const logEndRef                     = useRef<HTMLDivElement>(null)

  // run URL modal
  const [urlModalOpen, setUrlModalOpen] = useState(false)
  const [appUrl, setAppUrl]             = useState('')

  // history accordion
  const [historyOpen, setHistoryOpen]   = useState<string | null>(null)
  const [allRunsOpen, setAllRunsOpen]   = useState(false)

  // queries
  const { data: tcs = [] } = useGetTestCasesQuery(appId, { skip: !appId })
  const { data: history = [], refetch: refetchHistory } = useGetExecutorResultsQuery(
    { appId }, { skip: !appId, pollingInterval: 30000 }
  )

  const readyTcs  = tcs.filter(tc => (tc.status ?? '').toUpperCase() !== 'NEEDS_REVIEW')
  const selected  = tcs.filter(tc => selectedIds.includes(tc.tc_id))
  const suiteMethods = selected.map(tc => tc.method_name).filter(Boolean)

  // ── actions ────────────────────────────────────────────────────────────────

  const handleCreateSuite = () => {
    setImportResult(null); setRunDone(false); setLiveLog([]); setRunResults([])
    setView('suite')
  }

  const handleBack = () => {
    setView('table'); setSelectedIds([])
    setImportResult(null); setRunDone(false); setLiveLog([]); setRunResults([])
  }

  useEffect(() => {
    if (runDone) {
      refetchHistory()
      const t = setTimeout(() => refetchHistory(), 2000)
      return () => clearTimeout(t)
    }
  }, [runDone, refetchHistory])

  const handleImported = (result: ImportDataResp) => {
    setImportResult(result)
    setImportOpen(false)
  }

  const handleRun = useCallback(async (url: string) => {
    setRunError(''); setLiveLog([]); setRunResults([]); setRunDone(false)
    setUrlModalOpen(false)
    setRunSubTab('logs'); setRunning(true); setView('running')

    try {
      const res = await fetch('/dashboard/api/execute/run-suite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: appId, java_dir: frameworkDir, app_url: url }),
      })
      if (!res.body) throw new Error('No response body')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const obj = JSON.parse(line.slice(6))
            if (obj.line !== undefined) {
              const text = String(obj.line)
              setLiveLog(prev => {
                const updated = [...prev, text].slice(-200)
                setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
                return updated
              })
            } else if (obj.exit_code !== undefined) {
              // set results immediately from the SSE payload, then refetch history
              if (Array.isArray(obj.tests)) {
                setRunResults(obj.tests as ExecutorTestResult[])
              }
              setRunDone(true)
              setRunning(false)
              setRunSubTab('results')
            } else if (Array.isArray(obj.tests)) {
              setRunResults(obj.tests as ExecutorTestResult[])
            }
          } catch { /* ignore malformed events */ }
        }
      }
    } catch (e: unknown) {
      setRunError(String((e as Error)?.message ?? e))
      setRunning(false)
    }
  }, [appId, frameworkDir, refetchHistory])

  // ── test case table columns ────────────────────────────────────────────────

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
          onChange={(e: CheckboxChangeEvent) => setSelectedIds(prev =>
            e.target.checked ? [...prev, row.tc_id] : prev.filter(id => id !== row.tc_id)
          )} />
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
    { title: 'Status', width: 140, render: (_: unknown, row: TestCase) => <StatusBadge status={row.status} /> },
    { title: 'Confidence', width: 100, render: (_: unknown, row: TestCase) => {
      const c = row.confidence
      if (c == null) return <span style={{ color: C.muted }}>—</span>
      return <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: c >= 0.75 ? C.green : C.amber }}>{(c * 100).toFixed(0)}%</span>
    }},
    { title: 'Last Run', width: 140, render: (_: unknown, row: TestCase) =>
      <span style={{ fontSize: 12, color: C.muted }}>{row.last_run ? fmtDateTime(row.last_run) : '—'}</span>
    },
  ]

  // ── run results table columns ──────────────────────────────────────────────

  const runResultColumns: TableColumnsType<ExecutorTestResult> = [
    { title: 'Test Case', render: (_: unknown, r: ExecutorTestResult) =>
      <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12 }}>{r.method}</span> },
    { title: 'Status', width: 110, render: (_: unknown, r: ExecutorTestResult) => <StatusBadge status={r.status} /> },
    { title: 'Duration', width: 100, render: (_: unknown, r: ExecutorTestResult) =>
      <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: C.muted }}>{r.duration_ms != null ? `${r.duration_ms}ms` : '—'}</span> },
    { title: 'Error', render: (_: unknown, r: ExecutorTestResult) => <FailureCell msg={r.error} /> },
  ]

  // ── render ─────────────────────────────────────────────────────────────────

  const panel = (children: React.ReactNode) => (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '16px 20px', marginBottom: 16 }}>
      {children}
    </div>
  )

  const sectionHeader = (title: string) => (
    <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 14 }}>
      {title}
    </div>
  )

  return (
    <div>
      {/* ── header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        {view !== 'table' && (
          <button onClick={handleBack}
            style={{ background: 'none', border: 'none', color: C.blue, cursor: 'pointer', fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, padding: 0 }}>
            ← Back
          </button>
        )}
        <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 15, fontWeight: 600, color: C.text }}>
          {view === 'table' ? 'Test Cases' : 'Test Suite'}
        </span>
      </div>

      {/* ── SUITE BUILDER PANEL ── */}
      {view === 'table' && panel(
        <>
          <Table<TestCase>
            dataSource={tcs.map(tc => ({ ...tc, key: tc.tc_id }))}
            columns={columns} pagination={false} size="small" scroll={{ y: 340 }}
            rowClassName={row => (row.status ?? '').toUpperCase() === 'NEEDS_REVIEW' ? 'exec-muted-row' : ''}
            locale={{ emptyText: <span style={{ color: C.muted }}>No test cases yet — plan some in Test Design</span> }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <Button type="primary" disabled={selectedIds.length === 0} onClick={handleCreateSuite}>
              Create Test Suite ▶
            </Button>
          </div>
        </>
      )}

      {(view === 'suite' || view === 'running') && panel(
        <>
          {sectionHeader('Selected Test Cases')}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
            {selected.map(tc => (
              <span key={tc.tc_id} style={{
                background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 16,
                fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: C.text,
                padding: '3px 12px',
              }}>
                {tc.tc_name}
              </span>
            ))}
          </div>

          {/* import status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {importResult ? (
              <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: C.green }}>
                ✓ Data imported — {Object.entries(importResult.imported).map(([m, n]) => `${m}: ${n} rows`).join(', ')}
              </span>
            ) : (
              <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: C.muted }}>
                ⊙ No test data imported yet
              </span>
            )}
            <Button onClick={() => setImportOpen(true)} disabled={view === 'running'}>
              Import Test Data
            </Button>
            <Button type="primary" disabled={!importResult || running} loading={running}
              onClick={() => setUrlModalOpen(true)}>
              Run ▶
            </Button>
          </div>

          {runError && (
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: C.red, marginTop: 10 }}>
              {runError}
            </div>
          )}
        </>
      )}

      {/* ── RUN OUTPUT PANEL ── */}
      {view === 'running' && panel(
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            {sectionHeader(running ? 'Running…' : 'Run Complete')}
            <SubTabToggle active={runSubTab} onChange={setRunSubTab} C={C} />
          </div>

          {/* Live Logs */}
          {runSubTab === 'logs' && (
            <div style={{
              background: C.surface2 ?? C.surface, border: `1px solid ${C.border}`, borderRadius: 6,
              fontFamily: "'IBM Plex Mono',monospace", fontSize: 11,
              maxHeight: 300, overflowY: 'auto', padding: '10px 14px',
            }}>
              {liveLog.length === 0
                ? <span style={{ color: C.muted }}>Waiting for output…</span>
                : liveLog.map((line, i) => (
                  <div key={i} style={{ color: C.muted, marginBottom: 2, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                    {line}
                  </div>
                ))
              }
              <div ref={logEndRef} />
            </div>
          )}

          {/* Test Case Results */}
          {runSubTab === 'results' && (
            <>
              {runDone && runResults.length > 0 && (
                <div style={{ display: 'flex', gap: 20, fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, marginBottom: 14, flexWrap: 'wrap' }}>
                  <span style={{ color: C.green }}>✓ {runResults.filter(r => ['PASS','PASSED'].includes((r.status ?? '').toUpperCase())).length} Passed</span>
                  <span style={{ color: C.red }}>✗ {runResults.filter(r => ['FAIL','FAILED'].includes((r.status ?? '').toUpperCase())).length} Failed</span>
                  <span style={{ color: C.muted }}>⏱ {runResults.reduce((a, r) => a + (r.duration_ms ?? 0), 0)}ms</span>
                </div>
              )}
              {!runDone
                ? <span style={{ color: C.muted, fontFamily: "'IBM Plex Mono',monospace", fontSize: 13 }}>
                    Results will appear when the run completes.
                  </span>
                : <Table<ExecutorTestResult>
                    dataSource={runResults.map((r, i) => ({ ...r, key: i }))}
                    columns={runResultColumns} pagination={false} size="small" scroll={{ y: 280 }}
                  />
              }
            </>
          )}
        </>
      )}

      {/* ── RUN URL MODAL ── */}
      <Modal
        title="Test Target URL"
        open={urlModalOpen}
        onOk={() => handleRun(appUrl)}
        onCancel={() => setUrlModalOpen(false)}
        okText="Run ▶"
        okButtonProps={{ disabled: !appUrl.trim() }}
      >
        <p style={{ marginBottom: 8 }}>Enter the application URL to run tests against:</p>
        <Input
          placeholder="https://www.cms.gov"
          value={appUrl}
          onChange={e => setAppUrl(e.target.value)}
          onPressEnter={() => appUrl.trim() && handleRun(appUrl)}
          autoFocus
        />
        <p style={{ marginTop: 8, fontSize: 12, color: '#888' }}>
          This will be passed as <code>-Dapp.url</code> to Maven.
        </p>
      </Modal>

      {/* ── IMPORT MODAL ── */}
      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={handleImported}
        suiteMethodNames={suiteMethods}
        appId={appId}
        javaDir={frameworkDir}
        C={C}
        isDark={isDark}
      />

      {/* ── PAST EXECUTION RESULTS ── */}
      {(() => {
        const runs = history as ExecutorRunResult[]
        const total = runs.length

        const renderRunCard = (run: ExecutorRunResult, globalIndex: number) => {
          const passed  = run.tests.filter(t => ['PASS','PASSED'].includes((t.status ?? '').toUpperCase())).length
          const failed  = run.tests.filter(t => ['FAIL','FAILED'].includes((t.status ?? '').toUpperCase())).length
          const totalMs = run.tests.reduce((a, t) => a + (t.duration_ms ?? 0), 0)
          const isOpen  = historyOpen === run.run_id
          return (
            <div key={run.run_id ?? globalIndex} style={{ border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 10, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', background: C.surface, padding: '12px 16px', gap: 10 }}>
                <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, flex: 1 }}>
                  <div style={{ fontWeight: 600, color: C.text }}>Run #{total - globalIndex}</div>
                  <div style={{ color: C.muted, marginTop: 2 }}>{fmtDateTime(run.started_at)}</div>
                  <div style={{ color: C.muted, marginTop: 4 }}>
                    {run.tests.length} tests ·{' '}
                    <span style={{ color: C.green }}>✓ {passed} passed</span> ·{' '}
                    <span style={{ color: C.red }}>✗ {failed} failed</span>
                    {'  '}⏱ {totalMs}ms
                  </div>
                </div>
                <button onClick={() => setHistoryOpen(isOpen ? null : run.run_id)}
                  style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 4, color: C.muted, cursor: 'pointer', fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, height: 28, padding: '0 10px', flexShrink: 0 }}>
                  {isOpen ? 'Hide ▲' : 'View ▼'}
                </button>
              </div>
              {isOpen && (
                <div style={{ padding: '12px 16px', background: C.surface }}>
                  {run.tests.length === 0
                    ? <span style={{ color: C.muted, fontSize: 12 }}>No test detail.</span>
                    : <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                        <thead><tr>
                          {['Test Case', 'Status', 'Duration', 'Error'].map(h =>
                            <th key={h} style={{ background: C.surface2, border: `1px solid ${C.border}`, fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: C.muted, padding: '6px 10px', textAlign: 'left', textTransform: 'uppercase' }}>{h}</th>
                          )}
                        </tr></thead>
                        <tbody>{run.tests.map((t, ti) =>
                          <tr key={ti}>
                            <td style={{ border: `1px solid ${C.border}`, padding: '7px 10px', fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: C.text }}>{t.method}</td>
                            <td style={{ border: `1px solid ${C.border}`, padding: '7px 10px' }}><StatusBadge status={t.status} /></td>
                            <td style={{ border: `1px solid ${C.border}`, padding: '7px 10px', fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: C.muted }}>{t.duration_ms != null ? `${t.duration_ms}ms` : '—'}</td>
                            <td style={{ border: `1px solid ${C.border}`, padding: '7px 10px' }}><FailureCell msg={t.error} /></td>
                          </tr>
                        )}</tbody>
                      </table>
                  }
                </div>
              )}
            </div>
          )
        }

        return (
          <div style={{ marginTop: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 14, fontWeight: 600, color: C.text }}>
                Past Execution Results
              </div>
              {total > 3 && (
                <button onClick={() => setAllRunsOpen(true)}
                  style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 4, color: C.muted, cursor: 'pointer', fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, height: 28, padding: '0 12px' }}>
                  View All ({total}) ▶
                </button>
              )}
            </div>

            {total === 0
              ? <span style={{ color: C.muted, fontSize: 13 }}>No executions yet.</span>
              : runs.slice(0, 3).map((run, i) => renderRunCard(run, i))
            }

            <Drawer
              title={<span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 14 }}>All Execution Runs ({total})</span>}
              placement="right"
              width={700}
              open={allRunsOpen}
              onClose={() => setAllRunsOpen(false)}
            >
              {runs.map((run, i) => renderRunCard(run, i))}
            </Drawer>
          </div>
        )
      })()}


      <style>{`
        .exec-muted-row { opacity: 0.55; }
        .ant-table-wrapper .ant-table { background: transparent !important; }
        .ant-table-wrapper .ant-table-thead > tr > th { background: ${C.surface2} !important; color: ${C.muted} !important; font-family: 'IBM Plex Mono',monospace; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
        .ant-table-wrapper .ant-table-tbody > tr > td { border-color: ${C.border} !important; }
        .ant-table-wrapper .ant-table-tbody > tr:hover > td { background: ${isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)'} !important; }
        .ant-modal-close { color: ${C.muted} !important; }
      `}</style>
    </div>
  )
}
