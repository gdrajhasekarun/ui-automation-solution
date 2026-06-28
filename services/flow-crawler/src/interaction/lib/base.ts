import type { LibInteractorMap } from './index.js'

export const baseInteractors: LibInteractorMap = {
  textbox: {
    async fill(page, selector, value) { await page.fill(selector, value) },
  },
  textarea: {
    async fill(page, selector, value) { await page.fill(selector, value) },
  },
  combobox: {
    async click(page, selector) { await page.click(selector) },
    async getOptions(page, selector) {
      return page.$$eval(`${selector} option`, opts => opts.map(o => (o as HTMLOptionElement).text))
    },
  },
  select: {
    async click(page, selector) { await page.click(selector) },
    async getOptions(page, selector) {
      return page.$$eval(`${selector} option`, opts => opts.map(o => (o as HTMLOptionElement).text))
    },
  },
  checkbox: { async click(page, selector) { await page.click(selector) } },
  button:   { async click(page, selector) { await page.click(selector) } },
}
