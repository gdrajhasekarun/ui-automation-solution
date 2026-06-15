import type { Page } from 'playwright'
import type { CapturedElement, UILibrary } from '../types.js'
import { highlightElement, removeHighlight, capturePageElements, findNewElements } from '../capture/index.js'
import { getLibInteractor } from './lib/index.js'
import { safeClick } from './safeClick.js'
import * as textHandler  from './textHandler.js'
import * as radioHandler from './radioHandler.js'
import * as buttonHandler from './buttonHandler.js'
import * as linkHandler  from './linkHandler.js'
import * as tabHandler   from './tabHandler.js'

export interface InteractResult {
  action:      'fill' | 'click' | 'navigate' | 'new_tab' | 'content_change' | 'skip'
  navigated:   boolean
  toUrl:       string | null
  newTab:      Page | null
  newElements: CapturedElement[]
}

export async function dispatch(
  page: Page,
  element: CapturedElement,
  allElements: CapturedElement[],
  radioGroup: CapturedElement[],
  uiLibrary: UILibrary,
  headless: boolean,
  resolvedValue: string | null,
): Promise<InteractResult> {
  const selector = element._selector
  if (!selector) return skip()

  if (!headless) await highlightElement(page, selector).catch(() => {})

  try {
    const type = element.elementType

    // ── Fill types ─────────────────────────────────────────────────────────────
    if (type === 'textbox' || type === 'textarea') {
      if (!resolvedValue) return skip()
      const libHandler = getLibInteractor(uiLibrary, type)
      if (libHandler?.fill) {
        await libHandler.fill(page, selector, resolvedValue)
      } else {
        await textHandler.fill(page, selector, resolvedValue)
      }
      await page.waitForTimeout(300)
      return { action: 'fill', navigated: false, toUrl: null, newTab: null, newElements: [] }
    }

    // ── Radio ──────────────────────────────────────────────────────────────────
    if (type === 'radio') {
      const newElements: CapturedElement[] = []
      await radioHandler.clickAll(page, allElements, radioGroup, uiLibrary, (appeared) => {
        newElements.push(...appeared)
      })
      return { action: 'click', navigated: false, toUrl: null, newTab: null, newElements }
    }

    // ── Button ─────────────────────────────────────────────────────────────────
    if (type === 'button') {
      const result = await buttonHandler.click(page, element, uiLibrary, allElements)
      if (result.navigated) return { action: 'navigate', navigated: true, toUrl: result.toUrl, newTab: null, newElements: [] }
      return { action: 'content_change', navigated: false, toUrl: null, newTab: null, newElements: result.newElements }
    }

    // ── Link ───────────────────────────────────────────────────────────────────
    if (type === 'link') {
      const result = await linkHandler.follow(page, element)
      if (result.opensNewTab)    return { action: 'new_tab',      navigated: false, toUrl: result.toUrl, newTab: result.newTab, newElements: [] }
      if (result.navigated)      return { action: 'navigate',     navigated: true,  toUrl: result.toUrl, newTab: null, newElements: [] }
      if (result.contentChanged) return { action: 'content_change', navigated: false, toUrl: null, newTab: null, newElements: [] }
      return skip()
    }

    // ── Tab ────────────────────────────────────────────────────────────────────
    if (type === 'tab') {
      const result = await tabHandler.click(page, element, uiLibrary, allElements)
      if (result.newTab)    return { action: 'new_tab', navigated: false, toUrl: null, newTab: result.newTab, newElements: [] }
      if (result.navigated) return { action: 'navigate', navigated: true, toUrl: result.toUrl, newTab: null, newElements: [] }
      return { action: 'content_change', navigated: false, toUrl: null, newTab: null, newElements: result.newElements }
    }

    // ── Combobox / Select ──────────────────────────────────────────────────────
    if (type === 'combobox' || type === 'select') {
      // If this element IS already a dropdown option (role="option"), click it directly
      if (selector.includes('[role="option"]') || selector.startsWith('mat-option')) {
        await safeClick(page, selector)
        await page.waitForTimeout(300)
        return { action: 'content_change', navigated: false, toUrl: null, newTab: null, newElements: [] }
      }
      const libHandler = getLibInteractor(uiLibrary, type)
      if (resolvedValue) {
        if (libHandler?.fill) {
          await libHandler.fill(page, selector, resolvedValue)
        } else {
          await page.selectOption(selector, { label: resolvedValue }).catch(async () => {
            await page.selectOption(selector, { value: resolvedValue }).catch(() => {})
          })
        }
      } else {
        if (libHandler?.click) await libHandler.click(page, selector)
        else await safeClick(page, selector)
      }
      await page.waitForTimeout(300)
      return { action: 'click', navigated: false, toUrl: null, newTab: null, newElements: [] }
    }

    // ── Checkbox / Toggle ──────────────────────────────────────────────────────
    if (type === 'checkbox' || type === 'toggle') {
      const libHandler = getLibInteractor(uiLibrary, type)
      if (libHandler?.click) await libHandler.click(page, selector)
      else await safeClick(page, selector)
      return { action: 'click', navigated: false, toUrl: null, newTab: null, newElements: [] }
    }

    return skip()
  } finally {
    if (!headless) await removeHighlight(page, selector).catch(() => {})
  }
}

function skip(): InteractResult {
  return { action: 'skip', navigated: false, toUrl: null, newTab: null, newElements: [] }
}
