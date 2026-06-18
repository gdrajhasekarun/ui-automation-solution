import type { Page } from 'playwright'

export async function fill(page: Page, selector: string, value: string): Promise<void> {
  await page.fill(selector, value)
  await page.waitForTimeout(300)
}

export async function fillDate(page: Page, selector: string, value: string): Promise<void> {
  // Step 1: click → clear → type → blur (realistic user interaction)
  await page.click(selector).catch(() => {})
  await page.fill(selector, '').catch(() => {})
  await page.type(selector, value, { delay: 50 }).catch(() => {})
  await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null
    el?.blur()
  }, selector).catch(() => {})
  await page.waitForTimeout(200)

  // Step 2: check if value was retained
  const actual = await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLInputElement | null
    return el?.value ?? ''
  }, selector).catch(() => '')

  if (actual === value) return

  // Step 3: fallback — direct JS assignment + synthetic events
  await page.evaluate(({ sel, val }) => {
    const el = document.querySelector(sel) as HTMLInputElement | null
    if (!el) return
    el.value = val
    el.dispatchEvent(new Event('input',  { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }, { sel: selector, val: value })
  await page.waitForTimeout(150)
}
