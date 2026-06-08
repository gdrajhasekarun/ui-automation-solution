import React, { useState } from 'react'
import { Layout, ConfigProvider, theme, Button, Tooltip, Tabs } from 'antd'
import { BulbOutlined, BulbFilled } from '@ant-design/icons'
import KnowledgeBaseTab from './components/KnowledgeBaseTab'
import TestDesignTab from './components/TestDesignTab'
import ExecutionTab from './components/ExecutionTab'
import { ThemeContext, DARK, LIGHT } from './theme'
import { useAppDispatch, useAppSelector } from './store'
import { toggleTheme } from './store/appSlice'

const { Header, Content } = Layout

const TAB_LABEL: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 13,
  fontWeight: 500,
  letterSpacing: '0.02em',
}

export default function App() {
  const dispatch    = useAppDispatch()
  const isDark      = useAppSelector(s => s.app.isDark)
  const [activeTab, setActiveTab] = useState('kb')
  const C = isDark ? DARK : LIGHT

  const tabItems = [
    {
      key: 'kb',
      label: <span style={TAB_LABEL}>Knowledge Base</span>,
      children: <KnowledgeBaseTab />,
    },
    {
      key: 'td',
      label: <span style={TAB_LABEL}>Test Design</span>,
      children: <TestDesignTab onGoToExecution={() => setActiveTab('ex')} />,
    },
    {
      key: 'ex',
      label: <span style={TAB_LABEL}>Execution</span>,
      children: <ExecutionTab />,
    },
  ]

  return (
    <ThemeContext.Provider value={{ isDark, C, toggle: () => dispatch(toggleTheme()) }}>
      <ConfigProvider
        theme={{
          algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
          token: {
            colorBgBase:          C.bg,
            colorBgContainer:     C.surface,
            colorBgLayout:        C.bg,
            colorBgElevated:      C.surface,
            colorBorder:          C.border,
            colorBorderSecondary: C.border,
            colorPrimary:         C.blue,
            colorSuccess:         C.green,
            colorWarning:         C.amber,
            colorError:           C.red,
            colorText:            C.text,
            colorTextSecondary:   C.muted,
            fontFamily:           "'IBM Plex Sans', sans-serif",
            fontFamilyCode:       "'IBM Plex Mono', monospace",
            borderRadius: 6,
          },
        }}
      >
        <Layout style={{ height: '100vh', overflow: 'hidden', background: C.bg }}>
          <Header style={{
            background: C.surface, borderBottom: `1px solid ${C.border}`,
            display: 'flex', alignItems: 'center', padding: '0 24px',
            position: 'sticky', top: 0, zIndex: 100, height: 52,
          }}>
            <span style={{
              fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, fontWeight: 600,
              color: C.text, letterSpacing: '0.04em', whiteSpace: 'nowrap', marginRight: 32,
            }}>
              AI Test Automation
            </span>

            <div style={{ flex: 1, overflow: 'hidden' }}>
              <Tabs
                activeKey={activeTab}
                onChange={setActiveTab}
                items={tabItems.map(({ key, label }) => ({ key, label }))}
                tabBarStyle={{ margin: 0, border: 'none' }}
                tabBarGutter={0}
                size="small"
                renderTabBar={(props, DefaultTabBar) => (
                  <DefaultTabBar {...props} style={{ margin: 0, border: 'none', background: 'transparent' }} />
                )}
              />
            </div>

            <Tooltip title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}>
              <Button
                type="text"
                icon={isDark
                  ? <BulbOutlined style={{ fontSize: 16 }} />
                  : <BulbFilled   style={{ fontSize: 16, color: C.amber }} />
                }
                onClick={() => dispatch(toggleTheme())}
                style={{ color: C.muted, marginLeft: 16, flexShrink: 0 }}
                aria-label="Toggle theme"
              />
            </Tooltip>
          </Header>

          <Content style={{ padding: 24, width: '100%', height: 'calc(100vh - 52px)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {activeTab === 'kb' && tabItems[0].children}
            {activeTab === 'td' && tabItems[1].children}
            {activeTab === 'ex' && tabItems[2].children}
          </Content>
        </Layout>

        <style>{`
          body { background: ${C.bg}; margin: 0; }
          .ant-tabs-top > .ant-tabs-nav { margin-bottom: 0 !important; }
          .ant-tabs-top > .ant-tabs-nav::before { border-bottom: none !important; }
          .ant-tabs-tab { padding: 6px 16px !important; }
          .ant-tabs-tab-active .ant-tabs-tab-btn { color: ${C.text} !important; }
          .ant-tabs-ink-bar { background: ${C.blue} !important; height: 2px !important; }
          .ant-table-wrapper .ant-table { background: transparent !important; }
          .ant-table-wrapper .ant-table-thead > tr > th {
            background: ${C.surface2} !important; color: ${C.muted} !important;
            font-family: 'IBM Plex Mono',monospace; font-size: 11px;
            text-transform: uppercase; letter-spacing: 0.04em;
          }
          .ant-table-wrapper .ant-table-tbody > tr > td { border-color: ${C.border} !important; }
          .ant-table-wrapper .ant-table-tbody > tr:hover > td {
            background: ${isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)'} !important;
          }
          /* Make the table wrapper and body fill the flex container */
          .ant-table-wrapper { height: 100%; display: flex; flex-direction: column; }
          .ant-table-wrapper .ant-spin-nested-loading { flex: 1; min-height: 0; }
          .ant-table-wrapper .ant-spin-container { height: 100%; display: flex; flex-direction: column; }
          .ant-table-wrapper .ant-table { flex: 1; min-height: 0; }
          .ant-table-wrapper .ant-table-container { height: 100%; display: flex; flex-direction: column; }
          .ant-table-wrapper .ant-table-body { flex: 1; min-height: 0; overflow-y: auto !important; }
        `}</style>
      </ConfigProvider>
    </ThemeContext.Provider>
  )
}
