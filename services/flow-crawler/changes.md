# Fix Plan: Verizon Radio Button Interaction

## 1. `src/capture/pageCapture.ts`

### Keep untrimmed aria-label for CSS selector (trailing space fix)

In `process()`, split the aria-label into raw (for selector) and trimmed (for display):

```ts
// Before:
const ariaRaw = (targetEl.getAttribute('aria-label') || '').trim()
const ariaLabel = this.isBoilerplate(ariaRaw) ? '' : ariaRaw

// After:
const ariaRawUntrimmed = targetEl.getAttribute('aria-label') || ''
const ariaRaw = ariaRawUntrimmed.trim()
const ariaLabel = this.isBoilerplate(ariaRaw) ? '' : ariaRaw
```

Update `buildSelector` signature to accept the untrimmed value and use it for the attribute selector:

```ts
// Before:
buildSelector(el, tag, ariaLabel, href, placeholder): string {
  ...
  if (ariaLabel) return `[aria-label="${ariaLabel.slice(0,80).replace(/"/g,'\\"')}"]`

// After:
buildSelector(el, tag, ariaLabel, href, placeholder, ariaLabelRaw = ''): string {
  ...
  const selectorAriaLabel = ariaLabelRaw || ariaLabel
  if (selectorAriaLabel) return `[aria-label="${selectorAriaLabel.slice(0,80).replace(/"/g,'\\"')}"]`
```

Pass `ariaRawUntrimmed` at the call site:

```ts
// Before:
const selector = this.buildSelector(targetEl, targetTag, ariaLabel, attrHref, placeholder)

// After:
const selector = this.buildSelector(targetEl, targetTag, ariaLabel, attrHref, placeholder, ariaRawUntrimmed)
```

### Add VzGPT labels to `GLOBAL_ELEMENT_LABELS`

```ts
const GLOBAL_ELEMENT_LABELS = new Set([
  // existing entries...
  'close drawer', 'close vzgpt drawer', 'open vzgpt', 'vzgpt',
])
```

---

## 2. `src/interaction/lib/base.ts`

**Remove `radio` from base interactors** — the default `page.click()` is unreliable for styled radio buttons; the dedicated `radioHandler` handles it:

```ts
// Remove this line:
radio: { async click(page, selector) { await page.click(selector) } },
```

---

## 3. `src/interaction/radioHandler.ts`

**Use `page.locator().click()` first, then JS native setter fallback:**

```ts
import { log } from '../logger.js'

// Inside the loop, replace the safeClick call with:
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
```

---

## 4. `src/llm/filterElements.ts`

**Always keep radio/checkbox elements** — never let LLM filter them out:

```ts
const alwaysKeepIds = new Set(
  elements.filter(e => e.elementType === 'radio' || e.elementType === 'checkbox').map(e => e.id)
)
// In the return:
return elements.filter(e => relevant.has(e.id) || gateIds.has(e.id) || alwaysKeepIds.has(e.id) || e.blocked)
```

---

## 5. `src/llm/pickNextAction.ts`

**Add product-page purchase preference rule** in the prompt rules block:

```ts
`- On a product detail page: if "Add to cart", "Buy", or "Get it now" is present, ALWAYS prefer it over pagination, color/size pickers, or promotional links to advance a purchase flow.`
```

---

## 6. `src/orchestration/flowRunner.ts`

### Step 1b — Radio group auto-fill (insert after form field fill, before Step 2)

Group radio elements using `page.locator().evaluate()` (not `document.querySelector` — must pierce shadow DOM) with this priority:
1. `el.name` HTML attribute → key `name:<name>`
2. `[role="radiogroup"]` ancestor aria-label or id → key `rg:<label>`
3. `[role="radiogroup"]` ancestor DOM index → key `rg:idx:<n>`
4. Common parent element DOM index → key `parent:idx:<n>`
5. Fallback → unique per-element key `__noname_<id>`

For each group, check `ctx.notes.fieldHints` values against option names (trim both sides before comparing). Click the matching option or default to `options[0]`. Dispatch via `dispatch()` with `action: 'select'`.

Exclude radio/checkbox from `navCandidates` so LLM never picks them:

```ts
const navCandidates = currentElements.filter(e =>
  e.elementType !== 'textbox' && e.elementType !== 'textarea' &&
  e.elementType !== 'select'  && e.elementType !== 'combobox' &&
  e.elementType !== 'radio'   && e.elementType !== 'checkbox' &&
  !disabledSelectors.includes((e.name ?? '').toLowerCase().slice(0, 60))
)
```

### Re-capture paths strip global elements before LLM filter

```ts
const nonGlobalCaptured = allCaptured.filter(e => !graph.globalElements.has(e.id))
currentElements = await filterElements(nonGlobalCaptured, ...)
```

Apply the same to the results-table re-capture path.

### Results table loop guard

Only enter the results-table path if that node doesn't already exist in the graph (prevents infinite loop when a static comparison table persists across interactions):

```ts
const resultsNodeIdCheck = resultsMeta ? nodeId(normalizeUrl(page.url()) + '#results') : null
if (resultsMeta && resultsMeta.dataRows > 0 && resultsNodeIdCheck && !graph.hasNode(resultsNodeIdCheck)) {
  // ... results table handling, use resultsNodeIdCheck as resultsNodeId
}
```

---

## 7. `crawl-notes.md` (new file at service root)

```markdown
# Verizon crawl hints

## General rules
- When on a smartphone product page (title contains "iPhone", "Samsung", "Pixel", etc.): click "Add to cart" or "Buy" to start the purchase flow. Do NOT click "next page of tiles" or pagination buttons.
- Ignore "Close VzGPT drawer", "Open VzGPT", or any VzGPT AI assistant elements — these are unrelated to purchasing.

## Field values
customer type: New customer
customer intent: New customer
user intent: New customer
```
