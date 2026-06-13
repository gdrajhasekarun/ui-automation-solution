import type { Page } from 'playwright'
import type { CapturedElement } from '../types.js'
import { capturePageElements, findNewElements } from '../capture/index.js'
import type { UILibrary } from '../types.js'
import { safeClick } from './safeClick.js'

export interface ButtonResult {
  navigated: boolean
  toUrl:     string | null
  newElements: CapturedElement[]
}

export async function click(
  page: Page,
  element: CapturedElement,
  uiLibrary: UILibrary,
  previousElements: CapturedElement[]
): Promise<ButtonResult> {
  if (!element._selector) return { navigated: false, toUrl: null, newElements: [] }

  const { getLibInteractor } = await import('./lib/index.js')
  const libHandler = getLibInteractor(uiLibrary, 'button')
  const beforeUrl = page.url()

  const navPromise = page.waitForNavigation({ timeout: 3000, waitUntil: 'networkidle' }).catch(() => null)

  try {
    if (libHandler?.click) {
      await libHandler.click(page, element._selector)
    } else {
      await safeClick(page, element._selector)
    }
    const navResult = await navPromise

    if (navResult && page.url() !== beforeUrl) {
      return { navigated: true, toUrl: page.url(), newElements: [] }
    }

    const currentElements = await capturePageElements(page, uiLibrary)
    const appeared = findNewElements(previousElements, currentElements)
    return { navigated: false, toUrl: null, newElements: appeared }
  } catch {
    return { navigated: false, toUrl: null, newElements: [] }
  }
}
