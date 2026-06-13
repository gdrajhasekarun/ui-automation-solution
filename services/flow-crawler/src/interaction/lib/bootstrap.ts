import type { LibInteractorMap } from './index.js'

export const bootstrapInteractors: LibInteractorMap = {
  textbox: {
    async fill(page, selector, value) { await page.fill(selector, value) },
  },
  combobox: {
    async click(page, selector) {
      await page.click(`${selector}[data-bs-toggle="dropdown"]`)
      await page.waitForSelector(`${selector} + .dropdown-menu.show`, { timeout: 2000 }).catch(() => {})
    },
    async getOptions(page, _selector) {
      return page.$$eval('.dropdown-menu.show .dropdown-item', els => els.map(e => (e as HTMLElement).innerText.trim()))
    },
  },
}
