import type { Page } from 'playwright'
import type { CapturedElement } from '../types.js'
import { capturePageElements, findNewElements } from '../capture/index.js'
import type { UILibrary } from '../types.js'
import { safeClick } from './safeClick.js'
import { log } from '../logger.js'

export async function clickAll(
  page: Page,
  elements: CapturedElement[],
  radioGroup: CapturedElement[],
  uiLibrary: UILibrary,
  onNewElements: (els: CapturedElement[]) => void
): Promise<void> {
  let previousElements = elements

  for (const option of radioGroup) {
    if (!option._selector) continue

    try {
      const clicked = await page.locator(option._selector).first()
        .click({ timeout: 3000 }).then(() => true).catch(() => false)

      if (clicked) {
        log.debug('RADIO', `  [${option.name}] Playwright click succeeded`)
      } else {
        log.debug('RADIO', `  [${option.name}] Playwright click failed — trying JS native setter`)
        const jsOk = await page.locator(option._selector).first().evaluate((el) => {
          const input = el as HTMLInputElement
          const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set
          if (nativeSetter) nativeSetter.call(input, true)
          else input.checked = true
          input.dispatchEvent(new Event('input',  { bubbles: true }))
          input.dispatchEvent(new Event('change', { bubbles: true }))
          input.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
          return true
        }).catch(() => false)
        log.debug('RADIO', `  [${option.name}] JS native setter: ${jsOk ? 'succeeded' : 'failed'}`)
        if (!jsOk) await safeClick(page, option._selector)
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
