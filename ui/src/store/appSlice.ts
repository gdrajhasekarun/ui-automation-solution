import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export type TargetTool = 'selenium-java' | 'selenium-csharp' | 'playwright-js' | 'playwright-ts' | 'playwright-python' | 'selenium-python' | 'cypress-js' | 'cypress-ts' | 'playwright-python' | 'selenium-python' | 'cypress-js' | 'cypress-ts'

interface AppState {
  appId:        string
  appUrl:       string
  frameworkDir: string
  targetTool:   TargetTool
  isDark:       boolean
  kbRefreshKey: number
}

// Remove stale defaults from previous sessions so the field doesn't silently misdirect output
const _staleFrameworkDirs = new Set(['./shared/java', './java', './framework'])
const storedFrameworkDir = localStorage.getItem('frameworkDir')
if (storedFrameworkDir && _staleFrameworkDirs.has(storedFrameworkDir)) {
  localStorage.removeItem('frameworkDir')
}

const _validTools = new Set<string>(['selenium-java', 'selenium-csharp', 'playwright-js', 'playwright-ts', 'playwright-python', 'selenium-python', 'cypress-js', 'cypress-ts'])
const _storedTool = localStorage.getItem('targetTool') ?? ''

const initial: AppState = {
  appId:        localStorage.getItem('appId')        ?? 'sample-app',
  appUrl:       localStorage.getItem('appUrl')        ?? '',
  frameworkDir: localStorage.getItem('frameworkDir')  ?? './molina-healthcare',
  targetTool:   (_validTools.has(_storedTool) ? _storedTool : 'selenium-java') as TargetTool,
  isDark:       localStorage.getItem('theme')         !== 'light',
  kbRefreshKey: 0,
}

const appSlice = createSlice({
  name: 'app',
  initialState: initial,
  reducers: {
    setAppId(state, action: PayloadAction<string>) {
      state.appId = action.payload
      localStorage.setItem('appId', action.payload)
    },
    setAppUrl(state, action: PayloadAction<string>) {
      state.appUrl = action.payload
      localStorage.setItem('appUrl', action.payload)
    },
    setFrameworkDir(state, action: PayloadAction<string>) {
      state.frameworkDir = action.payload
      localStorage.setItem('frameworkDir', action.payload)
    },
    setTargetTool(state, action: PayloadAction<TargetTool>) {
      state.targetTool = action.payload
      localStorage.setItem('targetTool', action.payload)
    },
    toggleTheme(state) {
      state.isDark = !state.isDark
      localStorage.setItem('theme', state.isDark ? 'dark' : 'light')
    },
    bumpKbRefresh(state) {
      state.kbRefreshKey += 1
    },
  },
})

export const { setAppId, setAppUrl, setFrameworkDir, setTargetTool, toggleTheme, bumpKbRefresh } = appSlice.actions
export default appSlice.reducer
