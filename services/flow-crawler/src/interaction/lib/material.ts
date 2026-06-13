import type { LibInteractorMap } from './index.js'

export const materialInteractors: LibInteractorMap = {
  textbox: {
    async fill(page, selector, value) {
      // Selector may already be the input itself (e.g. #mat-input-1) or a wrapper (mat-form-field)
      const directCount = await page.locator(selector).count()
      const tag = directCount > 0
        ? await page.locator(selector).first().evaluate((el) => el.tagName.toLowerCase())
        : ''
      const input = (tag === 'input' || tag === 'textarea')
        ? page.locator(selector).first()
        : page.locator(`${selector} input, ${selector} textarea`).first()
      await input.click()
      await input.selectText().catch(() => {})
      await input.fill('')
      await input.type(value, { delay: 30 })
    },
  },
  textarea: {
    async fill(page, selector, value) {
      const ta = page.locator(`${selector} textarea`).first()
      await ta.click()
      await ta.fill(value)
    },
  },
  combobox: {
    async click(page, selector) {
      await page.click(selector)
      await page.waitForSelector('mat-option, .MuiMenu-list', { timeout: 2000 }).catch(() => {})
    },
    async fill(page, selector, value) {
      // Open the mat-select / MUI select
      await page.click(selector)
      await page.waitForSelector('mat-option, .MuiMenuItem-root', { timeout: 3000 }).catch(() => {})

      // Try to find an option whose aria-label or text contains the value (case-insensitive)
      const val = value.trim().toLowerCase()
      const clicked = await page.evaluate((v) => {
        const options = Array.from(document.querySelectorAll('mat-option, .MuiMenuItem-root'))
        const match = options.find(el => {
          const ariaLabel = (el.getAttribute('aria-label') ?? '').trim().toLowerCase()
          const text      = (el.textContent ?? '').trim().toLowerCase()
          return ariaLabel.includes(v) || text.includes(v)
        })
        if (match) { (match as HTMLElement).click(); return true }
        return false
      }, val)

      if (!clicked) {
        // Fallback: click first available option
        await page.locator('mat-option, .MuiMenuItem-root').first().click().catch(() => {})
      }
      await page.waitForTimeout(300)
    },
    async getOptions(page, selector) {
      await page.click(selector)
      await page.waitForSelector('mat-option, .MuiMenuItem-root').catch(() => {})
      return page.$$eval('mat-option, .MuiMenuItem-root', els => els.map(e => (e as HTMLElement).innerText.trim()))
    },
  },
  checkbox: {
    async click(page, selector) {
      await page.click(`${selector} .MuiSvgIcon-root, ${selector} input`)
    },
  },
  radio: {
    async click(page, selector) {
      await page.click(`${selector} .MuiSvgIcon-root, ${selector} input`)
    },
  },
}
