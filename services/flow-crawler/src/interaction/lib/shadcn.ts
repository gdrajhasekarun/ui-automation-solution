import type { LibInteractorMap } from './index.js'

export const shadcnInteractors: LibInteractorMap = {
  textbox: {
    async fill(page, selector, value) { await page.fill(selector, value) },
  },
  combobox: {
    async click(page, selector) {
      await page.click(selector)
      await page.waitForSelector('[role="listbox"][data-radix-select-content]', { timeout: 2000 }).catch(() => {})
    },
    async getOptions(page, selector) {
      await page.click(selector)
      await page.waitForSelector('[data-radix-select-item]').catch(() => {})
      return page.$$eval('[data-radix-select-item]', els => els.map(e => (e as HTMLElement).innerText.trim()))
    },
  },
  checkbox: {
    async click(page, selector) { await page.click(selector) },
  },
}
