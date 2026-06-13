import type { Page } from 'playwright'

export async function highlightElement(page: Page, selector: string): Promise<void> {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null
    if (!el) return
    el.dataset.__crawlerPrev = el.style.cssText
    el.style.cssText += `
      outline: 3px solid #FFD700 !important;
      background-color: rgba(255, 215, 0, 0.25) !important;
      transition: outline 0.15s ease, background-color 0.15s ease;
    `
  }, selector)
}

export async function removeHighlight(page: Page, selector: string): Promise<void> {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null
    if (!el) return
    el.style.cssText = el.dataset.__crawlerPrev || ''
    delete el.dataset.__crawlerPrev
  }, selector)
}
