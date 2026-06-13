import type { Page } from 'playwright'
import { log } from '../logger.js'

// Selectors that indicate the page is in a loading state
const LOADING_SELECTORS = [
  // Angular Material
  'mat-progress-spinner',
  'mat-progress-bar',
  'mat-spinner',
  // Generic ARIA
  '[role="progressbar"]',
  '[aria-busy="true"]',
  // Common CSS patterns
  '.spinner',
  '.loading',
  '.loader',
  '[class*="spinner"]:not([class*="no-spinner"])',
  '[class*="loading-overlay"]',
  '[class*="load-overlay"]',
  // Skeleton screens
  '.skeleton',
  '[class*="skeleton"]',
  // Overlay backdrops (Angular CDK)
  '.cdk-overlay-backdrop',
  '.overlay-backdrop',
]

const LOADING_SELECTOR = LOADING_SELECTORS.join(', ')

/**
 * Wait for any visible loading/spinner indicators to disappear,
 * then wait for the network to settle.
 * Falls through gracefully if nothing is loading.
 */
export async function waitForIdle(page: Page, timeoutMs = 10000): Promise<void> {
  const start = Date.now()

  try {
    // First check if there are any loading indicators visible right now
    const hasSpinner = await page.evaluate((sel) => {
      const els = Array.from(document.querySelectorAll(sel)) as HTMLElement[]
      return els.some(el => {
        const r = el.getBoundingClientRect()
        const s = window.getComputedStyle(el)
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity) > 0
      })
    }, LOADING_SELECTOR).catch(() => false)

    if (!hasSpinner) return

    log.info('WAIT', 'Loading indicator detected — waiting for it to clear')

    // Wait until all loading indicators are gone
    await page.waitForFunction((sel) => {
      const els = Array.from(document.querySelectorAll(sel)) as HTMLElement[]
      return !els.some(el => {
        const r = el.getBoundingClientRect()
        const s = window.getComputedStyle(el)
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity) > 0
      })
    }, LOADING_SELECTOR, { timeout: timeoutMs }).catch(() => {
      log.warn('WAIT', `Loading indicator still present after ${timeoutMs}ms — proceeding anyway`)
    })

    const elapsed = Date.now() - start
    log.info('WAIT', `Loading cleared after ${elapsed}ms`)
  } catch {
    // Non-fatal — proceed regardless
  }

  // Brief settle for any post-load DOM updates
  await page.waitForTimeout(200).catch(() => {})
}
