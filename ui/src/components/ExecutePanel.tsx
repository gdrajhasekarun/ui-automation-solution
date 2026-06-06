import React, { useState, useEffect, useRef } from 'react'
import {
  Card, Button, Input, Space, Typography, Table, Tag,
  Divider, Empty, message, Collapse, Badge
} from 'antd'
import type { TableColumnsType } from 'antd'
import { PlayCircleOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons'
import type { TestCase, Parameter, TestResult, UiEvent } from '../types'

const { Text } = Typography

const STATUS_COLOR: Record<string, string> = { PASSED: 'success', FAILED: 'error', SKIPPED: 'warning' }
const STATUS_ICON: Record<string, React.ReactNode> = {
  PASSED:  <CheckCircleOutlined style={{ color: '#4ade80' }} />,
  FAILED:  <CloseCircleOutlined style={{ color: '#f87171' }} />,
  SKIPPED: <Badge status="warning" />,
}

interface Props {
  appId: string
  javaDir: string
  selectedTcs: TestCase[]
}

export default function ExecutePanel({ appId, javaDir, selectedTcs }: Props) {
  const [paramMap, setParamMap]     = useState<Record<string, Parameter[]>>({})
  const [formValues, setFormValues] = useState<Record<string, string>>({})
  const [running, setRunning]       = useState(false)
  const [runId, setRunId]           = useState<string | null>(null)
  const [results, setResults]       = useState<TestResult[]>([])
  const [liveEvents, setLiveEvents] = useState<UiEvent[]>([])
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!selectedTcs.length) return
    const load = async () => {
      const map: Record<string, Parameter[]> = {}
      for (const tc of selectedTcs) {
        try {
          const res = await fetch(`/api/test-cases/${tc.tc_id}/parameters`)
          const data = await res.json()
          map[tc.tc_id] = data.parameters ?? []
        } catch {}
      }
      setParamMap(map)
      setFormValues({})
      setResults([])
      setLiveEvents([])
      setRunId(null)
    }
    load()
  }, [selectedTcs])

  useEffect(() => {
    if (!running || !runId || !appId) return
    const poll = async () => {
      try {
        const res = await fetch(`/api/events/${appId}?limit=50`)
        const data = await res.json()
        const execEvents: UiEvent[] = (data.events ?? []).filter((e: UiEvent) => e.stage === 'EXECUTE')
        setLiveEvents(execEvents.slice(-30))
      } catch {}
      try {
        const res = await fetch(`/api/run/${runId}/results`)
        const data = await res.json()
        if (data.results?.length) { setResults(data.results); setRunning(false) }
      } catch {}
    }
    const id = setInterval(poll, 2000)
    return () => clearInterval(id)
  }, [running, runId, appId])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [liveEvents])

  const handleExecute = async () => {
    if (!selectedTcs.length) return message.warning('No test cases selected')
    const testData = selectedTcs.map(tc => {
      const params = paramMap[tc.tc_id] ?? []
      const values: Record<string, string> = {}
      for (const p of params) values[p.name] = formValues[`${tc.tc_id}__${p.name}`] ?? ''
      return { tc_name: tc.tc_name, values }
    })
    const rid = 'run-' + Date.now()
    setRunId(rid); setRunning(true); setResults([]); setLiveEvents([])
    try {
      await fetch('/api/execute/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_id: appId, run_id: rid, java_dir: javaDir,
          selected_tests: selectedTcs.map(t => t.method_name || t.tc_name),
          test_data: testData
        })
      })
    } catch (e) {
      message.error('Execute failed: ' + (e as Error).message)
      setRunning(false)
    }
  }

  const resultColumns: TableColumnsType<TestResult> = [
    {
      title: 'Test Case', dataIndex: 'tc_name',
      render: (t: string) => <Text style={{ color: '#f1f5f9', fontSize: 12 }}>{t}</Text>
    },
    {
      title: 'Status', dataIndex: 'status', width: 100,
      render: (s: string) => (
        <Space size={4}>{STATUS_ICON[s]}<Tag color={STATUS_COLOR[s] ?? 'default'}>{s}</Tag></Space>
      )
    },
    {
      title: 'Duration', dataIndex: 'duration_ms', width: 90,
      render: (ms: number) => <Text type="secondary" style={{ fontSize: 12 }}>{ms ? `${ms}ms` : '—'}</Text>
    },
    {
      title: 'Failure', dataIndex: 'failure_msg',
      render: (msg: string) => msg ? (
        <Collapse ghost size="small" items={[{
          key: '1',
          label: <Text type="danger" style={{ fontSize: 11 }}>Show error</Text>,
          children: <pre style={{ fontSize: 10, color: '#f87171', whiteSpace: 'pre-wrap' }}>{msg}</pre>
        }]} />
      ) : null
    }
  ]

  if (!selectedTcs.length) {
    return (
      <Card
        title={<Text strong style={{ color: '#f1f5f9', fontSize: 15 }}>Execute</Text>}
        style={{ background: '#1e293b', border: '1px solid #334155', height: '100%' }}
        styles={{ header: { borderBottom: '1px solid #334155' } }}
      >
        <Empty description={<Text type="secondary">Select test cases from Panel 3 to run</Text>} />
      </Card>
    )
  }

  const passed = results.filter(r => r.status === 'PASSED').length
  const failed = results.filter(r => r.status === 'FAILED').length

  return (
    <Card
      title={
        <Space>
          <Text strong style={{ color: '#f1f5f9', fontSize: 15 }}>Execute</Text>
          {results.length > 0 && (
            <Space size={4}>
              <Tag color="success">{passed} passed</Tag>
              {failed > 0 && <Tag color="error">{failed} failed</Tag>}
            </Space>
          )}
        </Space>
      }
      style={{ background: '#1e293b', border: '1px solid #334155', height: '100%' }}
      styles={{ header: { borderBottom: '1px solid #334155' } }}
    >
      <Space direction="vertical" style={{ width: '100%' }} size={10}>
        {selectedTcs.map(tc => {
          const params = paramMap[tc.tc_id] ?? []
          if (!params.length) return null
          return (
            <div key={tc.tc_id} style={{ background: '#0f172a', borderRadius: 6, padding: '10px 12px', border: '1px solid #334155' }}>
              <Text strong style={{ color: '#38bdf8', fontSize: 12 }}>{tc.tc_name}</Text>
              <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {params.map(p => (
                  <div key={p.name} style={{ minWidth: 140 }}>
                    <Text type="secondary" style={{ fontSize: 11 }}>{p.name}</Text>
                    <Input size="small" placeholder={p.type}
                      value={formValues[`${tc.tc_id}__${p.name}`] ?? ''}
                      onChange={e => setFormValues(prev => ({ ...prev, [`${tc.tc_id}__${p.name}`]: e.target.value }))}
                      style={{ marginTop: 2 }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )
        })}

        <Button type="primary" icon={<PlayCircleOutlined />} onClick={handleExecute} loading={running} block>
          {running ? 'Running…' : 'Execute Tests'}
        </Button>

        {(running || liveEvents.length > 0) && (
          <div ref={logRef} style={{
            height: 120, overflowY: 'auto', background: '#0f172a',
            borderRadius: 6, padding: '8px 10px', border: '1px solid #334155',
            fontFamily: 'monospace', fontSize: 11
          }}>
            {liveEvents.map((ev, i) => (
              <div key={i} style={{ color: '#94a3b8', marginBottom: 2 }}>
                <span style={{ color: '#64748b', marginRight: 6 }}>{ev.created_at?.slice(11, 19)}</span>
                {ev.message}
              </div>
            ))}
          </div>
        )}

        {results.length > 0 && (
          <>
            <Divider style={{ margin: '4px 0', borderColor: '#334155' }} />
            <Table<TestResult>
              dataSource={results} columns={resultColumns}
              pagination={false} rowKey="result_id" size="small" scroll={{ y: 200 }}
            />
          </>
        )}
      </Space>

      <style>{`
        .ant-table-wrapper .ant-table { background: transparent !important; }
        .ant-table-wrapper .ant-table-thead > tr > th { background: #0f172a !important; color: #94a3b8 !important; font-size: 12px; }
        .ant-table-wrapper .ant-table-tbody > tr > td { border-bottom: 1px solid #1e3a5f2222 !important; }
        .ant-table-wrapper .ant-table-tbody > tr:hover > td { background: #334155 !important; }
      `}</style>
    </Card>
  )
}
