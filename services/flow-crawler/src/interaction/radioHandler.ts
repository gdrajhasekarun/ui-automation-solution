import type { Page } from 'playwright'
import type { CapturedElement } from '../types.js'
import { capturePageElements, findNewElements } from '../capture/index.js'
import type { UILibrary } from '../types.js'
import { safeClick } from './safeClick.js'

export async function clickAll(
  page: Page,
  elements: CapturedElement[],
  radioGroup: CapturedElement[],
  uiLibrary: UILibrary,
  onNewElements: (els: CapturedElement[]) => void
): Promise<void> {
  const { getLibInteractor } = await import('./lib/index.js')
  let previousElements = elements

  for (const option of radioGroup) {
    if (!option._selector) continue
    const libHandler = getLibInteractor(uiLibrary, 'radio')

    try {
      if (libHandler?.click) {
        await libHandler.click(page, option._selector)
      } else {
        await safeClick(page, option._selector)
      }
      await page.waitForTimeout(300)

      const currentElements = await capturePageElements(page, uiLibrary)
      const appeared = findNewElements(previousElements, currentElements)
      if (appeared.length > 0) onNewElements(appeared)
      previousElements = currentElements
    } catch {
      // Skip unclickable option
    }
  }
}
