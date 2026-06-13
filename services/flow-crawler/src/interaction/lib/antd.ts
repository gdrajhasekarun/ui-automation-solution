import type { LibInteractorMap } from './index.js'

export const antdInteractors: LibInteractorMap = {
  textbox: {
    async fill(page, selector, value) {
      await page.click(selector)
      await page.fill(selector, value)
      await page.evaluate((sel) => {
        const el = document.querySelector(sel) as HTMLInputElement | null
        el?.dispatchEvent(new Event('input',  { bubbles: true }))
        el?.dispatchEvent(new Event('change', { bubbles: true }))
      }, selector)
    },
  },
  combobox: {
    async click(page, selector) {
      await page.click(`${selector} .ant-select-selector`)
      await page.waitForSelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden)', { timeout: 2000 }).catch(() => {})
    },
    async getOptions(page, selector) {
      await page.click(`${selector} .ant-select-selector`)
      await page.waitForSelector('.ant-select-item-option').catch(() => {})
      return page.$$eval('.ant-select-item-option-content', els => els.map(e => (e as HTMLElement).innerText.trim()))
    },
  },
  checkbox: {
    async click(page, selector) {
      await page.click(`${selector} .ant-checkbox, ${selector} input`)
    },
  },
  radio: {
    async click(page, selector) {
      await page.click(`${selector} .ant-radio, ${selector} input`)
    },
  },
}
