import type { LibInteractorMap } from './index.js'

export const vuetifyInteractors: LibInteractorMap = {
  textbox: {
    async fill(page, selector, value) {
      const input = page.locator(`${selector} input, ${selector} textarea`).first()
      await input.click()
      await input.fill(value)
      await input.blur()
    },
  },
  combobox: {
    async click(page, selector) {
      await page.click(`${selector} .v-field__input, ${selector} input`)
      await page.waitForSelector('.v-overlay .v-list-item', { timeout: 2000 }).catch(() => {})
    },
    async getOptions(page, selector) {
      await page.click(`${selector} .v-field__input, ${selector} input`)
      await page.waitForSelector('.v-overlay .v-list-item').catch(() => {})
      return page.$$eval('.v-overlay .v-list-item-title', els => els.map(e => (e as HTMLElement).innerText.trim()))
    },
  },
  checkbox: {
    async click(page, selector) {
      await page.click(`${selector} .v-checkbox-btn, ${selector} input`)
    },
  },
}
