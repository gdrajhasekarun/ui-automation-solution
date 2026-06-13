import type { Page, BrowserContext } from 'playwright'
import type { CapturedElement, UILibrary } from '../types.js'
import { capturePageElements, findNewElements } from '../capture/index.js'
import { safeClick } from './safeClick.js'

export interface TabResult {
  navigated:   boolean
  toUrl:       string | null
  newTab:      Page | null
  newElements: CapturedElement[]
}

export async function click(
  page: Page,
  element: CapturedElement,
  uiLibrary: UILibrary,
  previousElements: CapturedElement[]
): Promise<TabResult> {
  if (!element._selector) return { navigated: false, toUrl: null, newTab: null, newElements: [] }

  const { getLibInteractor } = await import('./lib/index.js')
  const libHandler = getLibInteractor(uiLibrary, 'tab')
  const beforeUrl  = page.url()
  const context    = page.context()

  const newTabPromise = context.waitForEvent('page', { timeout: 2000 }).catch(() => null)

  try {
    if (libHandler?.click) {
      await libHandler.click(page, element._selector)
    } else {
      await safeClick(page, element._selector)
    }

    const newTab = await newTabPromise

    if (newTab) {
      return { navigated: false, toUrl: null, newTab, newElements: [] }
    }

    if (page.url() !== beforeUrl) {
      return { navigated: true, toUrl: page.url(), newTab: null, newElements: [] }
    }

    const currentElements = await capturePageElements(page, uiLibrary)
    const appeared = findNewElements(previousElements, currentElements)
    return { navigated: false, toUrl: null, newTab: null, newElements: appeared }
  } catch {
    return { navigated: false, toUrl: null, newTab: null, newElements: [] }
  }
}
