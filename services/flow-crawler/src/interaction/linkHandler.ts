import type { Page } from 'playwright'
import type { CapturedElement } from '../types.js'
import { safeClick } from './safeClick.js'

export interface LinkResult {
  navigated:   boolean
  toUrl:       string | null
  opensNewTab: boolean
  newTab:      Page | null
}

export async function follow(page: Page, element: CapturedElement): Promise<LinkResult> {
  if (!element._selector) return { navigated: false, toUrl: null, opensNewTab: false, newTab: null }

  const opensNewTab = await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLAnchorElement | null
    return el?.target === '_blank' || (el?.rel ?? '').includes('noopener')
  }, element._selector).catch(() => false)

  if (opensNewTab) {
    // Actually click and capture the new tab instead of returning early with null
    try {
      const [newPage] = await Promise.all([
        page.context().waitForEvent('page', { timeout: 5000 }),
        safeClick(page, element._selector),
      ])
      await newPage.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {})
      return { navigated: false, toUrl: newPage.url(), opensNewTab: true, newTab: newPage }
    } catch {
      // Click fired but no new tab appeared — fall through to same-tab navigation
    }
  }

  const beforeUrl = page.url()
  try {
    await safeClick(page, element._selector)
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
    const after = page.url()
    return { navigated: after !== beforeUrl, toUrl: after, opensNewTab: false, newTab: null }
  } catch {
    return { navigated: false, toUrl: null, opensNewTab: false, newTab: null }
  }
}
