import type { Page } from 'playwright'
import type { UILibrary } from '../types.js'

export async function detectUILibrary(page: Page): Promise<UILibrary> {
  return page.evaluate((): UILibrary => {
    const head = document.head.innerHTML
    const body = document.body.innerHTML.slice(0, 8000)

    if (
      head.includes('material') || body.includes('MuiButton') ||
      !!document.querySelector('.MuiButton-root, .MuiTextField-root, .MuiFormControl-root')
    ) return 'material'

    if (
      head.includes('ionic') ||
      !!document.querySelector('ion-app, ion-button, ion-input, ion-content')
    ) return 'ionic'

    if (
      head.includes('antd') || head.includes('ant-design') ||
      !!document.querySelector('.ant-btn, .ant-input, .ant-select')
    ) return 'antd'

    if (
      head.includes('chakra') || body.includes('chakra') ||
      !!document.querySelector('[class*="chakra-"]')
    ) return 'chakra'

    if (
      head.includes('vuetify') || body.includes('v-app') ||
      !!document.querySelector('.v-btn, .v-text-field, .v-app')
    ) return 'vuetify'

    if (
      body.includes('data-radix-') || body.includes('data-state') ||
      !!document.querySelector('[data-radix-collection-item], [cmdk-root]')
    ) return 'shadcn'

    if (
      !!document.querySelector('.btn.btn-primary, .form-control, .form-check') ||
      head.includes('bootstrap')
    ) return 'bootstrap'

    // Tailwind: utility classes but no component library
    const hasTailwind = Array.from(document.querySelectorAll('[class]')).some(el =>
      /\b(bg|text|flex|grid|p|m|w|h)-/.test((el as HTMLElement).className)
    )
    if (hasTailwind) return 'tailwind'

    return 'unknown'
  })
}
