import React, { useState } from 'react'
import { Layout, Typography } from 'antd'
import { RobotOutlined } from '@ant-design/icons'
import ServicesPanel from './components/ServicesPanel'
import PipelinePanel from './components/PipelinePanel'
import TestCasesPanel from './components/TestCasesPanel'
import ExecutePanel from './components/ExecutePanel'
import type { TestCase } from './types'

const { Header, Content } = Layout
const { Title } = Typography

export default function App() {
  const [appId, setAppId] = useState<string>(
    () => localStorage.getItem('appId') ?? 'sample-app'
  )
  const [javaDir, setJavaDir] = useState<string>(
    () => localStorage.getItem('javaDir') ?? './shared/java'
  )
  const [selectedTcs, setSelectedTcs] = useState<TestCase[]>([])
  const [testCasesRefresh, setTestCasesRefresh] = useState(0)

  const onAppIdChange = (v: string) => { setAppId(v); localStorage.setItem('appId', v) }
  const onJavaDirChange = (v: string) => { setJavaDir(v); localStorage.setItem('javaDir', v) }

  return (
    <Layout style={{ minHeight: '100vh', background: '#0f172a' }}>
      <Header style={{
        background: '#1e293b',
        borderBottom: '1px solid #334155',
        display: 'flex', alignItems: 'center', gap: 12, padding: '0 24px'
      }}>
        <RobotOutlined style={{ fontSize: 22, color: '#38bdf8' }} />
        <Title level={4} style={{ margin: 0, color: '#f1f5f9' }}>
          AI Test Automation POC
        </Title>
        <span style={{ marginLeft: 8, color: '#64748b', fontSize: 13 }}>
          5 microservices · event-driven pipeline
        </span>
      </Header>

      <Content style={{ padding: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <ServicesPanel />
          <PipelinePanel
            appId={appId} javaDir={javaDir}
            onAppIdChange={onAppIdChange}
            onJavaDirChange={onJavaDirChange}
          />
          <TestCasesPanel
            appId={appId} javaDir={javaDir}
            selectedTcs={selectedTcs}
            setSelectedTcs={setSelectedTcs}
            refreshKey={testCasesRefresh}
            onPlanStarted={() => setTestCasesRefresh(r => r + 1)}
          />
          <ExecutePanel
            appId={appId} javaDir={javaDir}
            selectedTcs={selectedTcs}
          />
        </div>
      </Content>
    </Layout>
  )
}
