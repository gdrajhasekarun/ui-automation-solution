import { createContext, useContext } from 'react'

export interface ThemeColors {
  bg:      string
  surface: string
  surface2:string
  border:  string
  text:    string
  muted:   string
  blue:    string
  green:   string
  amber:   string
  red:     string
  // semantic
  inProgress: string
  complete:   string
  needsReview:string
  failed:     string
}

export const DARK: ThemeColors = {
  bg:       '#111827',
  surface:  '#161B22',
  surface2: '#0D1117',
  border:   '#30363D',
  text:     '#E6EDF3',
  muted:    '#8B949E',
  blue:     '#1F6FEB',
  green:    '#238636',
  amber:    '#E3B341',
  red:      '#DA3633',
  inProgress: '#1F6FEB',
  complete:   '#238636',
  needsReview:'#E3B341',
  failed:     '#DA3633',
}

export const LIGHT: ThemeColors = {
  bg:       '#F6F8FA',
  surface:  '#FFFFFF',
  surface2: '#F6F8FA',
  border:   '#D0D7DE',
  text:     '#1F2328',
  muted:    '#656D76',
  blue:     '#0969DA',
  green:    '#1A7F37',
  amber:    '#9A6700',
  red:      '#CF222E',
  inProgress: '#0969DA',
  complete:   '#1A7F37',
  needsReview:'#9A6700',
  failed:     '#CF222E',
}

export interface ThemeCtx {
  isDark: boolean
  C: ThemeColors
  toggle: () => void
}

export const ThemeContext = createContext<ThemeCtx>({
  isDark: true,
  C: DARK,
  toggle: () => {},
})

export const useTheme = () => useContext(ThemeContext)
