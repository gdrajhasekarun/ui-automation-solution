import type { LibInteractorMap } from './index.js'

export const chakraInteractors: LibInteractorMap = {
  textbox: {
    async fill(page, selector, value) {
      await page.click(selector)
      await page.fill(selector, value)
      await page.evaluate((sel) => {
        document.querySelector(sel)?.dispatchEvent(new Event('change', { bubbles: true }))
      }, selector)
    },
  },
  combobox: {
    async click(page, selector) {
      await page.click(selector)
      await page.waitForSelector('[role="listbox"], [role="menu"]', { timeout: 2000 }).catch(() => {})
    },
    async getOptions(page, selector) {
      await page.click(selector)
      await page.waitForSelector('[role="option"]').catch(() => {})
      return page.$$eval('[role="option"]', els => els.map(e => (e as HTMLElement).innerText.trim()))
    },
  },
}
