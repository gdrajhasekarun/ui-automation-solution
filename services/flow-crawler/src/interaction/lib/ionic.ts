import type { LibInteractorMap } from './index.js'

export const ionicInteractors: LibInteractorMap = {
  textbox: {
    async fill(page, selector, value) {
      await page.evaluate(([sel, val]: [string, string]) => {
        const host = document.querySelector(sel) as any
        if (!host) return
        host.value = val
        host.dispatchEvent(new CustomEvent('ionChange', { detail: { value: val }, bubbles: true }))
      }, [selector, value] as [string, string])
    },
  },
  combobox: {
    async click(page, selector) {
      await page.click(selector)
      await page.waitForSelector('ion-alert, ion-action-sheet', { timeout: 3000 }).catch(() => {})
    },
    async getOptions(page, selector) {
      await page.click(selector)
      await page.waitForSelector('ion-alert .alert-button, .action-sheet-button').catch(() => {})
      return page.$$eval(
        'ion-alert .alert-radio-label, .action-sheet-button',
        els => els.map(e => (e as HTMLElement).innerText.trim())
      )
    },
  },
  checkbox: {
    async click(page, selector) {
      await page.evaluate((sel) => {
        const el = document.querySelector(sel) as any
        el.checked = !el.checked
        el.dispatchEvent(new CustomEvent('ionChange', { detail: { checked: el.checked }, bubbles: true }))
      }, selector)
    },
  },
  toggle: {
    async click(page, selector) {
      await page.evaluate((sel) => {
        const el = document.querySelector(sel) as any
        el.checked = !el.checked
        el.dispatchEvent(new CustomEvent('ionChange', { detail: { checked: el.checked }, bubbles: true }))
      }, selector)
    },
  },
}
