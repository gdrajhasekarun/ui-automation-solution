import type { Page } from 'playwright'

export interface OverlayInfo {
  selector:     string
  role:         string
  coverageArea: { x: number; y: number; width: number; height: number }
}

export async function detectOverlays(page: Page): Promise<OverlayInfo[]> {
  return page.evaluate((): OverlayInfo[] => {
    const overlaySelectors = [
      '[role="dialog"]', '[role="alertdialog"]',
      '.modal', '.overlay', '.popup', '.drawer',
      '[class*="modal"]', '[class*="overlay"]', '[class*="dialog"]',
      '[class*="popup"]', '[class*="toast"]', '[class*="banner"]',
      'ion-modal', 'ion-alert', 'ion-popover',
      '.MuiDialog-root', '.MuiBackdrop-root',
      '.ant-modal-root', '.ant-drawer',
    ]

    return overlaySelectors
      .flatMap(sel => Array.from(document.querySelectorAll(sel)))
      .filter(el => {
        const style = window.getComputedStyle(el)
        const rect  = el.getBoundingClientRect()
        return style.display !== 'none' &&
               style.visibility !== 'hidden' &&
               style.opacity !== '0' &&
               rect.width > 0 && rect.height > 0
      })
      .map(el => {
        const rect = el.getBoundingClientRect()
        return {
          selector:    el.id ? `#${CSS.escape(el.id)}` : '.' + (el.className as string).trim().split(/\s+/)[0],
          role:        el.getAttribute('role') || el.tagName.toLowerCase(),
          coverageArea: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        }
      })
  })
}

export function isBlocked(
  elementBox: { x: number; y: number; width: number; height: number },
  overlays: OverlayInfo[]
): OverlayInfo | null {
  for (const overlay of overlays) {
    const o = overlay.coverageArea
    const e = elementBox
    // Check if overlay covers the element's center point
    const cx = e.x + e.width / 2
    const cy = e.y + e.height / 2
    if (cx >= o.x && cx <= o.x + o.width && cy >= o.y && cy <= o.y + o.height) {
      return overlay
    }
  }
  return null
}
