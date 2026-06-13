import type { Page } from 'playwright'

/**
 * Tries a normal click, then force-click, then JS dispatchEvent.
 * Crawlers need to interact with hidden/covered elements (custom dropdowns,
 * aria-hidden widgets, chatbot overlays) that block Playwright's pointer checks.
 */
export async function safeClick(page: Page, selector: string, timeout = 3000): Promise<void> {
  try {
    await page.click(selector, { timeout })
    return
  } catch {
    // Normal click failed — try force (bypasses pointer-event interception)
  }

  try {
    await page.click(selector, { force: true, timeout: 2000 })
    return
  } catch {
    // Force click failed — fall back to JS dispatch
  }

  // Last resort: JS click via dispatchEvent (works on aria-hidden elements)
  await page.locator(selector).first().evaluate((el) => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}
