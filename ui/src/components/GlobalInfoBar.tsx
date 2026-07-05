import { useTheme } from '../theme'
import { useAppSelector } from '../store'

export default function GlobalInfoBar() {
  const { C } = useTheme()
  const appId        = useAppSelector(s => s.app.appId)
  const frameworkDir = useAppSelector(s => s.app.frameworkDir)
  const MONO = { fontFamily: "'IBM Plex Mono', monospace" }

  return (
    <div style={{
      background: C.surface2,
      borderBottom: `1px solid ${C.border}`,
      padding: '6px 24px',
      display: 'flex',
      gap: 28,
      alignItems: 'center',
      flexShrink: 0,
      ...MONO,
      fontSize: 11,
    }}>
      <span style={{ color: C.muted }}>
        App ID:{' '}
        <span style={{ color: C.text, fontWeight: 600 }}>{appId || '—'}</span>
      </span>
      <span style={{ color: C.muted }}>
        Framework:{' '}
        <span style={{ color: C.text, fontWeight: 600 }}>{frameworkDir || '—'}</span>
      </span>
    </div>
  )
}
