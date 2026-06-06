import React, { useState, useEffect, useRef } from 'react'
import { Card, Button, Input, Space, Typography, Tag, Divider, Row, Col } from 'antd'
import { PlayCircleOutlined, ReloadOutlined } from '@ant-design/icons'
import type { UiEvent } from '../types'

const { Text } = Typography

const LEVEL_COLOR: Record<string, string> = {
  INFO: '#38bdf8', WARN: '#fbbf24', ERROR: '#f87171', SUCCESS: '#4ade80'
}

interface Props {
  appId: string
  javaDir: string
  onAppIdChange: (v: string) => void
  onJavaDirChange: (v: string) => void
}

export default function PipelinePanel({ appId, javaDir, onAppIdChange, onJavaDirChange }: Props) {
  const [events, setEvents]   = useState<UiEvent[]>([])
  const [loading, setLoading] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!appId) return
    const poll = async () => {
      try {
        const res = await fetch(`/api/events/${appId}?limit=100`)
        const data = await res.json()
        setEvents(data.events ?? [])
      } catch {}
    }
    poll()
    const id = setInterval(poll, 2000)
    return () => clearInterval(id)
  }, [appId])

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [events])

  const trigger = async (triggerType: string) => {
    setLoading(triggerType)
    try {
      await fetch('/api/crawl/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_id: appId, app_url: '',
          build_id: 'build-' + Date.now(),
          trigger_type: triggerType
        })
      })
    } finally {
      setLoading('')
    }
  }

  return (
    <Card
      title={<Text strong style={{ color: '#f1f5f9', fontSize: 15 }}>Pipeline</Text>}
      style={{ background: '#1e293b', border: '1px solid #334155', height: '100%' }}
      styles={{ header: { borderBottom: '1px solid #334155' } }}
    >
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <Row gutter={8}>
          <Col span={12}>
            <Text type="secondary" style={{ fontSize: 12 }}>App ID</Text>
            <Input value={appId} onChange={e => onAppIdChange(e.target.value)}
              placeholder="sample-app" size="small" style={{ marginTop: 4 }} />
          </Col>
          <Col span={12}>
            <Text type="secondary" style={{ fontSize: 12 }}>Java Dir</Text>
            <Input value={javaDir} onChange={e => onJavaDirChange(e.target.value)}
              placeholder="./shared/java" size="small" style={{ marginTop: 4 }} />
          </Col>
        </Row>

        <Space>
          <Button type="primary" icon={<PlayCircleOutlined />}
            loading={loading === 'INITIAL'} onClick={() => trigger('INITIAL')} size="small">
            Trigger 1 — Initial Setup
          </Button>
          <Button icon={<ReloadOutlined />}
            loading={loading === 'UPDATE'} onClick={() => trigger('UPDATE')} size="small">
            Trigger 2 — Update
          </Button>
        </Space>

        <Divider style={{ margin: '8px 0', borderColor: '#334155' }} />

        <div ref={listRef} style={{
          height: 260, overflowY: 'auto', background: '#0f172a',
          borderRadius: 6, padding: '8px 10px', border: '1px solid #334155'
        }}>
          {events.length === 0 && (
            <Text type="secondary" style={{ fontSize: 12 }}>Waiting for events…</Text>
          )}
          {events.map((ev, i) => (
            <div key={ev.event_id ?? i} style={{ marginBottom: 4, fontSize: 12, fontFamily: 'monospace' }}>
              <span style={{ color: '#64748b', marginRight: 6 }}>
                {ev.created_at?.slice(11, 19)}
              </span>
              <Tag color={LEVEL_COLOR[ev.level] ?? '#64748b'}
                style={{ fontSize: 10, padding: '0 4px', marginRight: 6 }}>
                {ev.stage}
              </Tag>
              <span style={{ color: '#cbd5e1' }}>{ev.message}</span>
            </div>
          ))}
        </div>
      </Space>
    </Card>
  )
}
