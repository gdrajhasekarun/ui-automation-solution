import React, { useState, useEffect } from 'react'
import { Card, Table, Tag, Badge, Typography, Space } from 'antd'
import { ThunderboltOutlined, ClockCircleOutlined, CheckCircleOutlined } from '@ant-design/icons'
import type { ServiceHealth } from '../types'

const { Text } = Typography

type DeployType = 'lambda-style' | 'on-demand' | 'always-on'

interface ServiceRow {
  key: string
  name: string
  port: number
  type: DeployType
  local?: boolean
}

const SERVICES: ServiceRow[] = [
  { key: 'dashboard', name: 'Dashboard API',     port: 8000, type: 'always-on',    local: true },
  { key: 'crawl',     name: 'Crawl Service',     port: 8001, type: 'lambda-style' },
  { key: 'generator', name: 'Generator Service', port: 8002, type: 'lambda-style' },
  { key: 'planner',   name: 'Planner Service',   port: 8003, type: 'on-demand' },
  { key: 'executor',  name: 'Executor Service',  port: 8004, type: 'always-on' },
]

const TYPE_COLOR: Record<DeployType, string> = {
  'lambda-style': 'cyan',
  'on-demand':    'gold',
  'always-on':    'red',
}

const TYPE_ICON: Record<DeployType, React.ReactNode> = {
  'lambda-style': <ThunderboltOutlined />,
  'on-demand':    <ClockCircleOutlined />,
  'always-on':    <CheckCircleOutlined />,
}

export default function ServicesPanel() {
  const [health, setHealth] = useState<Record<string, ServiceHealth>>({})

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/api/services/health')
        const data: Record<string, ServiceHealth> = await res.json()
        setHealth(data)
      } catch {}
    }
    poll()
    const id = setInterval(poll, 5000)
    return () => clearInterval(id)
  }, [])

  const columns = [
    {
      title: 'Service',
      dataIndex: 'name' as const,
      render: (name: string, row: ServiceRow) => (
        <Space>
          <Text strong style={{ color: '#f1f5f9' }}>{name}</Text>
          <Text type="secondary">:{row.port}</Text>
        </Space>
      )
    },
    {
      title: 'Type',
      dataIndex: 'type' as const,
      render: (type: DeployType) => (
        <Tag icon={TYPE_ICON[type]} color={TYPE_COLOR[type]} style={{ borderRadius: 4 }}>
          {type}
        </Tag>
      )
    },
    {
      title: 'Status',
      render: (_: unknown, row: ServiceRow) => {
        if (row.local) {
          return <Badge status="processing" text={<Text style={{ color: '#4ade80' }}>online</Text>} />
        }
        const svc = health[row.key]
        if (!svc) return <Badge status="default" text={<Text type="secondary">unknown</Text>} />
        const isOffline = svc.status === 'offline'
        const isRunning = svc.status === 'running'
        const badgeStatus = isOffline ? 'error' : isRunning ? 'processing' : 'success'
        const color = isOffline ? '#f87171' : isRunning ? '#38bdf8' : '#4ade80'
        return <Badge status={badgeStatus} text={<Text style={{ color }}>{svc.status}</Text>} />
      }
    }
  ]

  return (
    <Card
      title={<Text strong style={{ color: '#f1f5f9', fontSize: 15 }}>Services</Text>}
      style={{ background: '#1e293b', border: '1px solid #334155', height: '100%' }}
      styles={{ header: { borderBottom: '1px solid #334155' } }}
    >
      <Table<ServiceRow>
        dataSource={SERVICES}
        columns={columns}
        pagination={false}
        rowKey="key"
        size="small"
        style={{ background: 'transparent' }}
      />
      <Text type="secondary" style={{ fontSize: 11, marginTop: 8, display: 'block' }}>
        Refreshes every 5s
      </Text>
    </Card>
  )
}
