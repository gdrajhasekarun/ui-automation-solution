import type { Page } from 'playwright'

export async function fill(page: Page, selector: string, value: string): Promise<void> {
  await page.click(selector)
  await page.fill(selector, value)
  await page.waitForTimeout(300)
}
