import { createSlice, PayloadAction } from '@reduxjs/toolkit'

interface AppState {
  appId:        string
  appUrl:       string
  frameworkDir: string
  isDark:       boolean
}

const initial: AppState = {
  appId:        localStorage.getItem('appId')        ?? 'sample-app',
  appUrl:       localStorage.getItem('appUrl')        ?? '',
  frameworkDir: localStorage.getItem('frameworkDir')  ?? './shared/java',
  isDark:       localStorage.getItem('theme')         !== 'light',
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
    toggleTheme(state) {
      state.isDark = !state.isDark
      localStorage.setItem('theme', state.isDark ? 'dark' : 'light')
    },
  },
})

export const { setAppId, setAppUrl, setFrameworkDir, toggleTheme } = appSlice.actions
export default appSlice.reducer
