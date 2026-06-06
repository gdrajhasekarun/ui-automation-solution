import React, { useState, useEffect } from 'react'
import {
  Card, Button, Input, Space, Typography, Table, Tag,
  Checkbox, message, Divider, Alert
} from 'antd'
import type { TableColumnsType } from 'antd'
import { FileExcelOutlined, RobotOutlined, SyncOutlined } from '@ant-design/icons'
import type { TestCase } from '../types'

const { Text } = Typography

const STATUS_COLOR: Record<string, string> = {
  PLANNED:      'default',
  READY:        'success',
  NEEDS_REVIEW: 'warning',
  PASSED:       'success',
  FAILED:       'error',
}

interface RawTc { tc_name: string; description: string }

interface Props {
  appId: string
  javaDir: string
  selectedTcs: TestCase[]
  setSelectedTcs: React.Dispatch<React.SetStateAction<TestCase[]>>
  refreshKey: number
  onPlanStarted: () => void
}

export default function TestCasesPanel({ appId, javaDir, selectedTcs, setSelectedTcs, refreshKey, onPlanStarted }: Props) {
  const [excelPath, setExcelPath]     = useState('')
  const [loaded, setLoaded]           = useState<RawTc[]>([])
  const [dbCases, setDbCases]         = useState<TestCase[]>([])
  const [planLoading, setPlanLoading] = useState(false)
  const [polling, setPolling]         = useState(false)

  useEffect(() => {
    if (!appId) return
    const poll = async () => {
      try {
        const res = await fetch(`/api/test-cases/${appId}`)
        const data = await res.json()
        setDbCases(data.test_cases ?? [])
      } catch {}
    }
    poll()
    if (polling) {
      const id = setInterval(poll, 3000)
      return () => clearInterval(id)
    }
  }, [appId, polling, refreshKey])

  const loadExcel = async () => {
    if (!excelPath) return message.warning('Enter Excel file path')
    try {
      const res = await fetch('/api/plan/load-excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ excel_path: excelPath })
      })
      const data = await res.json()
      if (data.test_cases) {
        setLoaded(data.test_cases)
        message.success(`Loaded ${data.test_cases.length} test cases`)
      } else {
        message.error(data.detail ?? 'Failed to load')
      }
    } catch (e) {
      message.error('Failed to load: ' + (e as Error).message)
    }
  }

  const planAll = async () => {
    if (!loaded.length) return message.warning('Load Excel first')
    setPlanLoading(true)
    setPolling(true)
    onPlanStarted()
    try {
      for (const tc of loaded) {
        await fetch('/api/plan/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ app_id: appId, tc_name: tc.tc_name, description: tc.description, java_dir: javaDir })
        })
      }
      message.success('Planning started for all test cases')
    } finally {
      setPlanLoading(false)
    }
  }

  const toggleSelect = (tc: TestCase, checked: boolean) => {
    if (checked) setSelectedTcs(prev => [...prev, tc])
    else setSelectedTcs(prev => prev.filter(t => t.tc_id !== tc.tc_id))
  }

  const columns: TableColumnsType<TestCase> = [
    {
      title: '', width: 32,
      render: (_: unknown, row: TestCase) => (
        <Checkbox
          disabled={row.status === 'NEEDS_REVIEW'}
          checked={selectedTcs.some(t => t.tc_id === row.tc_id)}
          onChange={e => toggleSelect(row, e.target.checked)}
        />
      )
    },
    {
      title: 'Test Case', dataIndex: 'tc_name',
      render: (name: string) => <Text style={{ color: '#f1f5f9', fontSize: 12 }}>{name}</Text>
    },
    {
      title: 'Status', dataIndex: 'status', width: 120,
      render: (s: string) => <Tag color={STATUS_COLOR[s] ?? 'default'}>{s ?? 'PLANNED'}</Tag>
    },
    {
      title: 'Conf.', dataIndex: 'confidence', width: 60,
      render: (c: number) => c
        ? <Text style={{ fontSize: 12, color: c >= 0.75 ? '#4ade80' : '#fbbf24' }}>{(c * 100).toFixed(0)}%</Text>
        : <span>—</span>
    },
    {
      title: 'Review Reason', dataIndex: 'review_reason',
      render: (r: string) => r ? <Text type="warning" style={{ fontSize: 11 }}>{r}</Text> : null
    }
  ]

  return (
    <Card
      title={
        <Space>
          <Text strong style={{ color: '#f1f5f9', fontSize: 15 }}>Test Cases</Text>
          {polling && <SyncOutlined spin style={{ color: '#38bdf8', fontSize: 12 }} />}
        </Space>
      }
      style={{ background: '#1e293b', border: '1px solid #334155', height: '100%' }}
      styles={{ header: { borderBottom: '1px solid #334155' } }}
    >
      <Space direction="vertical" style={{ width: '100%' }} size={10}>
        <Space.Compact style={{ width: '100%' }}>
          <Input
            value={excelPath} onChange={e => setExcelPath(e.target.value)}
            placeholder="/path/to/test_cases.xlsx" size="small"
            prefix={<FileExcelOutlined style={{ color: '#4ade80' }} />}
          />
          <Button size="small" onClick={loadExcel}>Load</Button>
        </Space.Compact>

        {loaded.length > 0 && (
          <Alert
            message={`${loaded.length} test cases loaded from Excel`}
            type="info" showIcon style={{ padding: '4px 10px' }}
            action={
              <Button size="small" type="primary" icon={<RobotOutlined />}
                loading={planLoading} onClick={planAll}>
                Plan All
              </Button>
            }
          />
        )}

        {selectedTcs.length > 0 && (
          <Alert
            message={`${selectedTcs.length} test case(s) selected for execution`}
            type="success" showIcon style={{ padding: '4px 10px' }}
          />
        )}

        <Divider style={{ margin: '4px 0', borderColor: '#334155' }} />

        <Table<TestCase>
          dataSource={dbCases} columns={columns} pagination={false}
          rowKey="tc_id" size="small" scroll={{ y: 260 }}
          rowClassName={(row) => row.status === 'NEEDS_REVIEW' ? 'review-row' : ''}
          locale={{ emptyText: <Text type="secondary">No test cases planned yet</Text> }}
        />
      </Space>

      <style>{`
        .review-row { background: rgba(251,191,36,0.08) !important; }
        .ant-table-wrapper .ant-table { background: transparent !important; }
        .ant-table-wrapper .ant-table-thead > tr > th { background: #0f172a !important; color: #94a3b8 !important; font-size: 12px; }
        .ant-table-wrapper .ant-table-tbody > tr > td { border-bottom: 1px solid #1e3a5f2222 !important; }
        .ant-table-wrapper .ant-table-tbody > tr:hover > td { background: #334155 !important; }
      `}</style>
    </Card>
  )
}
