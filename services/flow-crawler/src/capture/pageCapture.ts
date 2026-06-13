import type { Page } from 'playwright'
import { createHash } from 'crypto'
import type { CapturedElement, UILibrary } from '../types.js'

// Boilerplate aria-labels that should be ignored — accessibility widget noise
const BOILERPLATE = [
  'press combination of alt',
  'screen reader',
  'skip to main',
  'skip navigation',
]

function stableId(selector: string, label: string): string {
  return createHash('sha1').update(`${selector}|${label}`).digest('hex').slice(0, 10)
}

function classifyElementType(tag: string, role: string, inputType: string): CapturedElement['elementType'] {
  if (tag === 'input') {
    if (inputType === 'radio')    return 'radio'
    if (inputType === 'checkbox') return 'checkbox'
    if (inputType === 'submit' || inputType === 'button' || inputType === 'reset') return 'button'
    return 'textbox'
  }
  if (tag === 'textarea')  return 'textarea'
  if (tag === 'select')    return 'select'
  if (tag === 'button')    return 'button'
  if (tag === 'a')         return 'link'

  const r = role.toLowerCase()
  if (r === 'radio')      return 'radio'
  if (r === 'checkbox')   return 'checkbox'
  if (r === 'button')     return 'button'
  if (r === 'link')       return 'link'
  if (r === 'tab')        return 'tab'
  if (r === 'combobox' || r === 'listbox') return 'combobox'
  if (r === 'switch' || r === 'togglebutton') return 'toggle'
  if (r === 'textbox')    return 'textbox'

  return 'other'
}

interface RawLiveElement {
  tag:         string
  role:        string
  label:       string
  selector:    string
  href:        string | null
  isFormField: boolean
  inputType:   string
  placeholder: string | null
  required:    boolean
}

export async function capturePageElements(
  page: Page,
  uiLibrary: UILibrary = 'unknown'
): Promise<CapturedElement[]> {
  // Ported from crawl-ai's focusedFlowTracer.ts extractLiveElements.
  // Uses live DOM visibility checks so only actually-rendered elements are captured.
  // All helpers use shorthand method syntax to avoid esbuild __name() wrapping issue.
  const rawElements: RawLiveElement[] = await page.evaluate((boilerplate: string[]) => {
    const h = {
      seen: new Set<string>(),
      results: [] as any[],

      isBoilerplate(text: string): boolean {
        const lc = text.toLowerCase()
        return boilerplate.some(b => lc.includes(b))
      },

      getOverlayRoot(): Element {
        // Check for open CDK overlay panels (Angular Material)
        const cdkContainer = document.querySelector('.cdk-overlay-container')
        if (cdkContainer) {
          const activePanel = cdkContainer.querySelector(
            '.cdk-overlay-pane, mat-select-panel, [class*="mat-select-panel"], [role="listbox"], [role="dialog"], [role="menu"]'
          ) as HTMLElement | null
          if (activePanel) {
            const pr = activePanel.getBoundingClientRect()
            const ps = window.getComputedStyle(activePanel)
            if (pr.width > 10 && pr.height > 10 && ps.display !== 'none' && ps.visibility !== 'hidden' && parseFloat(ps.opacity) > 0) {
              return cdkContainer
            }
          }
        }
        // Check for modals/dialogs
        const overlaySelectors = ['[role="dialog"]', '[role="alertdialog"]', '.modal', '.modal-content']
        for (const sel of overlaySelectors) {
          const overlay = document.querySelector(sel) as HTMLElement | null
          if (!overlay) continue
          const rect  = overlay.getBoundingClientRect()
          const style = window.getComputedStyle(overlay)
          const hasContent = overlay.querySelectorAll('a, button, [role="button"]').length > 0
          if (rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0 && hasContent) {
            return overlay
          }
        }
        return document.body
      },

      buildSelector(el: HTMLElement, tag: string, ariaLabel: string, href: string, placeholder: string): string {
        // Skip auto-generated Angular Material / CDK IDs — they change on re-render
        const autoGenId = /^(mat-input|mat-select|mat-option|mat-form-field|mat-chip|mat-tab|mat-expansion|mat-radio|mat-checkbox|mat-slide|cdk-)/i
        const elId = el.id && !/^\d/.test(el.id) && !autoGenId.test(el.id) ? el.id : ''
        if (elId)        return `#${elId}`
        if (ariaLabel)   return `[aria-label="${ariaLabel.slice(0, 80).replace(/"/g, '\\"')}"]`
        if (href && href !== '#' && !href.startsWith('javascript'))
                         return `a[href="${href.slice(0, 100).replace(/"/g, '\\"')}"]`
        if (placeholder) return `${tag}[placeholder="${placeholder.slice(0, 80).replace(/"/g, '\\"')}"]`
        return `${tag}:has-text("${(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50).replace(/"/g, '\\"')}")`
      },

      isVisible(el: HTMLElement): boolean {
        const rect  = el.getBoundingClientRect()
        const style = window.getComputedStyle(el)
        if (rect.width === 0 || rect.height === 0)  return false
        if (style.display     === 'none')            return false
        if (style.visibility  === 'hidden')          return false
        if (parseFloat(style.opacity) === 0)         return false
        return true
      },

      process() {
        const searchRoot = this.getOverlayRoot()

        const nodes = searchRoot.querySelectorAll(
          'a, button, [role="button"], [role="tab"], [role="menuitem"], [role="link"], [role="option"],' +
          'input:not([type="hidden"]), select, textarea,' +
          '[role="textbox"], [role="combobox"], [role="listbox"], [role="spinbutton"],' +
          '[role="checkbox"], [role="radio"], [role="switch"],' +
          'mat-select, mat-checkbox, mat-radio-button, mat-slide-toggle,' +
          'nav li, header li, [class*="nav"] li, [class*="menu"] li'
        )

        for (const node of Array.from(nodes)) {
          let targetEl = node as HTMLElement
          const tag = targetEl.tagName.toLowerCase()

          // For <li> — use the first anchor child
          if (tag === 'li') {
            const anchor = targetEl.querySelector('a[href]') as HTMLElement | null
            if (!anchor) continue
            targetEl = anchor
          }

          if (!this.isVisible(targetEl)) continue

          const targetTag  = targetEl.tagName.toLowerCase()
          const roleAttr   = (targetEl.getAttribute('role') || '').trim()
          const ariaRaw    = (targetEl.getAttribute('aria-label') || '').trim()
          const ariaLabel  = this.isBoilerplate(ariaRaw) ? '' : ariaRaw
          const titleAttr  = (targetEl.getAttribute('title') || '').trim()
          const inputType  = targetEl.getAttribute('type') || ''
          const placeholder = (targetEl.getAttribute('placeholder') || '').trim()
          const nameAttr   = (targetEl.getAttribute('name') || '').trim()
          const textCnt    = (targetEl.textContent || '').replace(/\s+/g, ' ').trim()
          const attrHref   = targetTag === 'a' ? (targetEl.getAttribute('href') || '') : ''
          const href       = targetTag === 'a' ? ((targetEl as HTMLAnchorElement).href || null) : null

          const isFormField = ['input', 'select', 'textarea'].includes(targetTag)
            || ['textbox', 'combobox', 'listbox', 'spinbutton', 'checkbox', 'radio', 'switch'].includes(roleAttr)
            || ['mat-select', 'mat-checkbox', 'mat-radio-button'].includes(targetTag)

          const rawLabel = isFormField
            ? (ariaLabel || placeholder || nameAttr || titleAttr || textCnt).slice(0, 120).trim()
            : (ariaLabel || titleAttr || textCnt).slice(0, 120).trim()

          if (!rawLabel || rawLabel.length < 2) continue
          if (!isFormField && rawLabel.length > 100 && !ariaLabel) continue
          if (this.isBoilerplate(rawLabel)) continue
          if (attrHref === '#' && !ariaLabel && !titleAttr) continue

          const selector = this.buildSelector(targetEl, targetTag, ariaLabel, attrHref, placeholder)

          const dedupeKey = `${rawLabel.slice(0, 60)}||${targetTag}`
          if (this.seen.has(dedupeKey)) continue
          this.seen.add(dedupeKey)

          const required = (targetEl as HTMLInputElement).required || targetEl.getAttribute('aria-required') === 'true'

          this.results.push({
            tag:         targetTag,
            role:        roleAttr,
            label:       rawLabel,
            selector,
            href,
            isFormField,
            inputType,
            placeholder: placeholder || null,
            required:    !!required,
          })
        }
        return this.results
      },
    }

    return h.process()
  }, BOILERPLATE)

  const captured: CapturedElement[] = []

  for (const raw of rawElements) {
    const id = stableId(raw.selector, raw.label)
    captured.push({
      id,
      tag:              raw.tag,
      elementType:      classifyElementType(raw.tag, raw.role, raw.inputType),
      role:             raw.role || null,
      name:             raw.label,
      label:            raw.label,
      placeholder:      raw.placeholder,
      required:         raw.required,
      visible:          true,
      blocked:          false,
      blockingElement:  null,
      boundingBox:      null,
      uiLibrary,
      libraryComponent: null,
      interactionKey:   null,
      fillSource:       null,
      fillConfidence:   null,
      href:             raw.href,
      inputType:        raw.inputType || null,
      _selector:        raw.selector,
      _resolvedValue:   null,
    })
  }

  return captured
}

export function findNewElements(prev: CapturedElement[], curr: CapturedElement[]): CapturedElement[] {
  const prevIds = new Set(prev.map(e => e.id))
  return curr.filter(e => !prevIds.has(e.id))
}

// No-op — live DOM approach does not inject attributes
export async function cleanupCrawlerAttrs(_page: Page): Promise<void> {}
