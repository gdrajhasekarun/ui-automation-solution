import type { Page } from 'playwright'
import type { CapturedElement } from '../types.js'
import { safeClick } from './safeClick.js'

export interface LinkResult {
  navigated:      boolean
  toUrl:          string | null
  opensNewTab:    boolean
  newTab:         Page | null
  contentChanged: boolean
}

export async function follow(page: Page, element: CapturedElement): Promise<LinkResult> {
  const none = { navigated: false, toUrl: null, opensNewTab: false, newTab: null, contentChanged: false }
  if (!element._selector) return none

  const opensNewTab = await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLAnchorElement | null
    return el?.target === '_blank' || (el?.rel ?? '').includes('noopener')
  }, element._selector).catch(() => false)

  if (opensNewTab) {
    try {
      const [newPage] = await Promise.all([
        page.context().waitForEvent('page', { timeout: 5000 }),
        safeClick(page, element._selector),
      ])
      await newPage.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {})
      return { navigated: false, toUrl: newPage.url(), opensNewTab: true, newTab: newPage, contentChanged: false }
    } catch {
      // fall through to same-tab navigation
    }
  }

  const beforeUrl = page.url()
  // Snapshot DOM state before click to detect content changes (e.g. autocomplete option selection)
  const beforeDom = await page.evaluate(() => document.body.innerHTML.length).catch(() => 0)

  try {
    await safeClick(page, element._selector)
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
    const afterUrl = page.url()

    if (afterUrl !== beforeUrl) {
      return { navigated: true, toUrl: afterUrl, opensNewTab: false, newTab: null, contentChanged: false }
    }

    // Same URL — check if DOM changed (autocomplete selection, modal open, etc.)
    const afterDom = await page.evaluate(() => document.body.innerHTML.length).catch(() => 0)
    const contentChanged = Math.abs(afterDom - beforeDom) > 50

    return { navigated: false, toUrl: afterUrl, opensNewTab: false, newTab: null, contentChanged }
  } catch {
    return none
  }
}
