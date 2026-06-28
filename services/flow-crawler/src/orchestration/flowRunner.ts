import type { Page, BrowserContext } from 'playwright'
import type { CrawlerConfig, CapturedElement, PathStep, ParsedNotes, Branch, Node } from '../types.js'
import type { CrawlerGraph } from '../graph/index.js'
import type { ExcelData } from '../data/index.js'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { normalizeUrl, nodeId, pageFingerprint } from '../graph/index.js'
import { capturePageElements, detectUILibrary, findNewElements, cleanupCrawlerAttrs, getPageHeading } from '../capture/index.js'
import { dispatch, safeClick, waitForIdle } from '../interaction/index.js'
import { captureNewTab } from '../navigation/index.js'
import { resolveValue } from '../data/index.js'
import { filterElements, pickNextAction, predictRoutes } from '../llm/index.js'
import { CrawlDataCache } from '../cache/index.js'
import { BranchQueue } from './branchQueue.js'
import { PathManager } from './pathManager.js'
import { log } from '../logger.js'

const BLOCKLIST = ['/logout', '/sign-out', '/signout', '/delete', '/destroy', '/remove']

function isBlocked(url: string): boolean {
  return BLOCKLIST.some(b => url.toLowerCase().includes(b))
}

export async function runFromPage(
  page: Page,
  currentNodeId: string,
  graph: CrawlerGraph,
  config: CrawlerConfig,
  ctx: {
    excelData: ExcelData
    notes: ParsedNotes
    cache: CrawlDataCache
    smartLLM: BaseChatModel | null
    fastLLM: BaseChatModel | null
    branchQueue: BranchQueue
    pathManager: PathManager
    phaseBSteps: PathStep[]
    depth: number
    existingNodes: Record<string, Node>
    // When set, record this edge using the REAL nodeId computed for this page
    // (avoids broken-edge bug when fingerprint causes a different id than the base URL hash)
    incomingEdge?: { fromNodeId: string; trigger: import('../types.js').Edge['trigger'] }
  }
): Promise<void> {
  if (ctx.depth > config.maxDepth) return
  if (graph.nodeCount >= config.maxPages)  return

  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
  await waitForIdle(page)

  const url       = page.url()
  const normUrl   = normalizeUrl(url)

  if (isBlocked(url)) return

  const library  = await detectUILibrary(page)
  const allElements = await capturePageElements(page, library)  // full set — always stored in graph
  let elements = allElements                                     // may be narrowed by LLM filter for interaction

  // Stabilise element names across runs: if a previous graph has an element with the same
  // selector on this page, reuse its stored name so POM method names don't drift.
  const selectorToStoredName = new Map<string, string>()
  for (const node of Object.values(ctx.existingNodes)) {
    for (const el of (node.elements ?? [])) {
      if (el._selector && el.name) selectorToStoredName.set(el._selector, el.name)
    }
  }
  for (const el of allElements) {
    if (el._selector && selectorToStoredName.has(el._selector)) {
      const stored = selectorToStoredName.get(el._selector)!
      if (stored !== el.name) {
        log.info('CAPTURE', `  stabilise name: "${el.name}" → "${stored}"  selector=${el._selector}`)
        el.name = stored
        el.label = stored
      }
    }
  }
  const title = await page.title()

  // When the same URL appears with different content (wizard steps), use element fingerprint
  // to create distinct node IDs so each step is captured separately in the graph.
  // Also deduplicate pages reachable via two different URLs (e.g. /#appointment vs /index.php#appointment):
  // if any existing node has the same element fingerprint, reuse its ID instead of creating a duplicate.
  const fp  = pageFingerprint(allElements.map(e => e.id))
  const baseId = nodeId(normUrl)
  const existingIdByFp = graph.findNodeByFingerprint(fp)
  const id  = existingIdByFp
    ? existingIdByFp
    : graph.hasNode(baseId) && graph.getNode(baseId)?.fingerprint !== fp
      ? nodeId(normUrl + '#' + fp.slice(0, 8))
      : baseId

  // Record the incoming edge now that we know the real nodeId for this page.
  // This is the correct place because recordEdge(toUrl) would compute baseId (URL hash only),
  // but when fingerprinting creates a different id, the edge target would be wrong.
  if (ctx.incomingEdge) {
    graph.addEdge({ from: ctx.incomingEdge.fromNodeId, to: id, trigger: ctx.incomingEdge.trigger })
  }

  log.step('CAPTURE', `[depth:${ctx.depth}] "${title || normUrl}"  library:${library}  elements:${elements.length}  node:${id}`)

  // Log all captured elements (mirrors crawl-ai FLOW_TRACE format)
  allElements.forEach((e, i) => {
    log.info('CAPTURE', `  [${String(i + 1).padStart(3)}] tag=${e.tag.padEnd(8)} type=${e.elementType.padEnd(8)} label="${e.name}"  selector=${e._selector}`)
  })

  // Register node if new — always store the FULL element set in the graph
  if (!graph.hasNode(id)) {
    const heading = await getPageHeading(page)
    const pageRef = graph.registerPageRef(heading)
    graph.addNode(id, {
      url, normalizedUrl: normUrl, title, pageRef,
      fingerprint: fp, uiLibrary: library,
      elements: allElements, unfilledFields: [],
    })
  } else {
    graph.updateNode(id, { elements: allElements })
  }

  // ── LLM element filter (Phase A only) ──────────────────────────────────────
  if (config.flowName && ctx.smartLLM && ctx.phaseBSteps.length === 0) {
    const before = elements.length

    // Skip elements already promoted to globalElements — they are shared chrome (nav/header/footer)
    // and are not flow-specific. Passing them to the LLM every page is redundant.
    const knownGlobalIds = graph.globalElements
    const nonGlobalElements = elements.filter(e => !knownGlobalIds.has(e.id))
    const skippedCount = before - nonGlobalElements.length
    if (skippedCount > 0) {
      log.info('FILTER', `  Skipped ${skippedCount} global element(s) before LLM filter`)
    }

    elements = await filterElements(nonGlobalElements, config.flowName, url, title, ctx.smartLLM)
    log.info('FILTER', `LLM filter "${config.flowName}": ${before} → ${elements.length} elements kept (${skippedCount} global skipped)`)
    elements.forEach((e, i) => {
      log.info('FILTER', `  [${String(i + 1).padStart(3)}] tag=${e.tag.padEnd(8)} type=${e.elementType.padEnd(8)} label="${e.name}"  selector=${e._selector}`)
    })
  }

  if (config.flowName && ctx.smartLLM) {
    // ── Focused flow mode ───────────────────────────────────────────────────────
    // Loop: fill forms → LLM picks one action → execute → if content_change re-capture and repeat
    // This handles multi-step same-page flows (e.g. Continue → form appears → fill → Submit)
    const seenStateKeys = new Set<string>()  // elementId + element-set fingerprint → prevent true loops
    let currentElements = elements
    let currentNodeId   = id   // advances to the latest wizard-step node as content changes
    let iterations = 0
    const MAX_SAME_PAGE_ITERS = 8
    const actionPath: string[] = []          // human-readable steps taken so far (passed to pickNextAction)
    let lastIntentCoverage = 0               // updated each pick, stored in eval

    while (iterations++ < MAX_SAME_PAGE_ITERS) {
      // Step 1: fill all form fields (including combobox/select dropdowns)
      const filledFieldLabels: string[] = []
      type PrereqAction = NonNullable<import('../types.js').Edge['trigger']['prerequisiteActions']>[number]
      const prerequisiteActions: PrereqAction[] = []
      const formFields = currentElements.filter(e =>
        e.elementType === 'textbox' || e.elementType === 'textarea' ||
        e.elementType === 'select'  || e.elementType === 'combobox'
      )
      for (const element of formFields) {
        if (!element._selector) continue

        // Skip fields the crawler already filled this session
        if (element._resolvedValue) {
          log.info('INTERACT', `  → skip     "${element.name}"  (already filled: "${element._resolvedValue}")`)
          continue
        }

        // Skip readonly fields (site pre-filled demo credentials etc.) — fill() will timeout on them
        const isReadonly = await page.evaluate((sel) => {
          const el = document.querySelector(sel) as HTMLInputElement | null
          return el ? el.readOnly || el.hasAttribute('readonly') : false
        }, element._selector).catch(() => false)
        if (isReadonly) {
          log.info('INTERACT', `  → skip     "${element.name}"  (readonly)`)
          continue
        }

        // Skip editable fields that already have a value (browser autofill or previous step)
        // Exception: select/combobox defaults should still be overridden by the LLM if the flow requires it
        const currentVal = await page.evaluate((sel) => {
          const el = document.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement | null
          return el ? el.value?.trim() ?? '' : ''
        }, element._selector).catch(() => '')
        const isDropdown = element.elementType === 'select' || element.elementType === 'combobox'
        if (currentVal && !isDropdown) {
          log.info('INTERACT', `  → skip     "${element.name}"  (pre-populated: "${currentVal}")`)
          continue
        }

        // For select/combobox: read available options from DOM and attach to element for LLM reasoning
        if (element.elementType === 'select' || element.elementType === 'combobox') {
          const opts = await page.evaluate((sel) => {
            const el = document.querySelector(sel) as HTMLSelectElement | null
            if (!el) return []
            return Array.from(el.options).map(o => o.text.trim()).filter(t => t.length > 0)
          }, element._selector!).catch(() => [] as string[])
          if (opts.length) element._selectOptions = opts
        }

        const fillResult = await resolveValue(
          element, ctx.excelData, ctx.notes, ctx.cache,
          ctx.smartLLM, config, normUrl, undefined, config.flowName
        )

        let valueToFill = fillResult.value

        // Combobox/select fallback: if no resolved value, pick best matching option
        if (!valueToFill && (element.elementType === 'combobox' || element.elementType === 'select')) {
          const firstOption = await page.evaluate((sel) => {
            // Native <select>
            const select = document.querySelector(sel) as HTMLSelectElement | null
            if (select?.tagName === 'SELECT') {
              const opt = Array.from(select.options).find(o => o.value && o.value !== '')
              return opt?.text?.trim() ?? null
            }
            return null
          }, element._selector).catch(() => null)

          if (firstOption) {
            valueToFill = firstOption
            fillResult.source = 'cache'
            log.info('INTERACT', `  → auto-select "${element.name}"  first option="${firstOption}"`)
          } else {
            // For Angular Material mat-select / autocomplete: pick option that best matches flowName,
            // falling back to first option only if no keyword match found
            try {
              await safeClick(page, element._selector)
              await page.waitForTimeout(500)

              // Build keyword list from flowName for scoring
              const flowKeywords = (config.flowName ?? '')
                .toLowerCase()
                .replace(/[^a-z0-9\s]/g, '')
                .split(/\s+/)
                .filter(w => w.length > 3)

              const picked = await page.evaluate((keywords) => {
                const options = Array.from(document.querySelectorAll('mat-option, [role="option"]'))
                if (!options.length) return null
                // Score each option by how many flow keywords appear in its text
                let best: { el: Element; score: number } | null = null
                for (const opt of options) {
                  const text = (opt.textContent ?? '').toLowerCase()
                  const score = keywords.reduce((n: number, kw: string) => n + (text.includes(kw) ? 1 : 0), 0)
                  if (!best || score > best.score) best = { el: opt, score }
                }
                if (best && best.score > 0) {
                  (best.el as HTMLElement).click()
                  return (best.el.textContent ?? '').replace(/\s+/g, ' ').trim()
                }
                // No keyword match — fall back to first option
                const first = options[0] as HTMLElement
                first.click()
                return (first.textContent ?? '').replace(/\s+/g, ' ').trim()
              }, flowKeywords).catch(() => null)

              if (picked?.trim()) {
                valueToFill = picked.trim()
                await page.waitForTimeout(300)
                log.info('INTERACT', `  → mat-select  "${element.name}"  picked="${valueToFill}"`)
                element._resolvedValue = valueToFill
                continue  // already interacted, skip dispatch below
              } else {
                await page.keyboard.press('Escape').catch(() => {})
              }
            } catch { /* dropdown didn't open */ }
          }
        }

        if (valueToFill) {
          element._resolvedValue = valueToFill
          element.interactionKey = fillResult.key
          element.fillSource     = fillResult.source
          element.fillConfidence = fillResult.confidence
          log.step('INTERACT', `  → fill     "${element.name}"  value="${valueToFill}"  source=${fillResult.source}`)
          filledFieldLabels.push(element.name)
          actionPath.push(`fill "${element.name}" = "${valueToFill}"`)
          prerequisiteActions.push({
            elementId:   element.id,
            elementName: element.name ?? null,
            elementType: element.elementType,
            action:      (element.elementType === 'select' || element.elementType === 'combobox') ? 'select' : 'fill',
            value:       valueToFill,
            source:      fillResult.source ?? 'llm',
          })
          await dispatch(page, element, currentElements, [element], library, config.headless, valueToFill)
          await waitForIdle(page)
          if (fillResult.source === 'cache') graph.incrementCacheHits()
        }
      }

      // Step 1b: Radio group auto-fill — group radios by name/radiogroup/parent and dispatch the matching option
      const radioElements = currentElements.filter(e => e.elementType === 'radio')
      if (radioElements.length > 0) {
        // Group radios in the browser by name attr, radiogroup ancestor, or common parent
        type RadioGroupMap = Record<string, { selector: string; name: string }[]>
        const radioGroups: RadioGroupMap = await page.evaluate((selectors: string[]) => {
          const groups: RadioGroupMap = {}
          selectors.forEach((sel, idx) => {
            let el: HTMLInputElement | null = null
            try { el = document.querySelector(sel) as HTMLInputElement | null } catch { /* Playwright-specific selector like :has-text() — skip */ }
            if (!el) { groups[`__noname_${idx}`] = [{ selector: sel, name: '' }]; return }
            // Priority 1: name attribute
            if (el.name) {
              const key = `name:${el.name}`
              groups[key] = groups[key] ?? []
              groups[key].push({ selector: sel, name: el.getAttribute('aria-label') ?? el.value ?? '' })
              return
            }
            // Priority 2+3: [role="radiogroup"] ancestor
            const rg = el.closest('[role="radiogroup"]') as HTMLElement | null
            if (rg) {
              const rgLabel = (rg.getAttribute('aria-label') ?? rg.id ?? '').trim()
              const key = rgLabel ? `rg:${rgLabel}` : `rg:idx:${Array.from(document.querySelectorAll('[role="radiogroup"]')).indexOf(rg)}`
              groups[key] = groups[key] ?? []
              groups[key].push({ selector: sel, name: el.getAttribute('aria-label') ?? el.value ?? '' })
              return
            }
            // Priority 4: common parent DOM index
            const parent = el.parentElement
            const parentIdx = parent ? Array.from(document.querySelectorAll('*')).indexOf(parent) : -1
            const key = `parent:idx:${parentIdx}`
            groups[key] = groups[key] ?? []
            groups[key].push({ selector: sel, name: el.getAttribute('aria-label') ?? el.value ?? '' })
          })
          return groups
        }, radioElements.map(e => e._selector!).filter(Boolean)).catch(() => ({} as RadioGroupMap))

        const fieldHints = ctx.notes.fieldHints ?? {}
        for (const [groupKey, options] of Object.entries(radioGroups)) {
          if (!options.length) continue
          // Find matching option from notes hints
          const hintValues = Object.values(fieldHints).map((v: unknown) => String(v).trim().toLowerCase())
          const matched = options.find(o => hintValues.includes(o.name.trim().toLowerCase()))
          const chosen = matched ?? options[0]
          if (!chosen?.selector) continue
          // Find the CapturedElement for this option
          const el = radioElements.find(e => e._selector === chosen.selector) ?? radioElements[0]
          log.info('INTERACT', `  → radio    group="${groupKey}" option="${chosen.name}"  selector=${chosen.selector}`)
          await dispatch(page, { ...el, _selector: chosen.selector }, currentElements, [el], library, config.headless, null)
          await waitForIdle(page)
        }
      }

      // Step 2: LLM picks ONE navigation/action element — exclude disabled elements
      const disabledSelectors = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('button, [role="button"], a')).flatMap(el => {
          const disabled = (el as HTMLButtonElement).disabled ||
            el.getAttribute('aria-disabled') === 'true' ||
            el.classList.contains('disabled') ||
            el.hasAttribute('disabled')
          const text = (el.textContent ?? '').trim().slice(0, 60)
          return disabled && text ? [text.toLowerCase()] : []
        })
      }).catch(() => [] as string[])

      const navCandidates = currentElements.filter(e =>
        e.elementType !== 'textbox' && e.elementType !== 'textarea' &&
        e.elementType !== 'select'  && e.elementType !== 'combobox' &&
        e.elementType !== 'radio'   && e.elementType !== 'checkbox' &&
        !disabledSelectors.includes((e.name ?? '').toLowerCase().slice(0, 60))
      )
      log.info('PICK', `  [iter ${iterations}] Asking LLM to pick next action from ${navCandidates.length} candidates for flow "${config.flowName}"`)
      if (actionPath.length > 0) {
        log.info('PICK', `  Steps completed so far:`)
        actionPath.forEach((step, i) => log.info('PICK', `    ${String(i + 1).padStart(2)}. ${step}`))
      }
      navCandidates.forEach((e, i) => {
        log.info('PICK', `    [${String(i + 1).padStart(3)}] ${e.elementType.padEnd(8)} "${e.name}"  selector=${e._selector}`)
      })

      const pick = await pickNextAction(navCandidates, config.flowName, page.url(), await page.title(), ctx.smartLLM, filledFieldLabels, actionPath)

      if (!pick) {
        log.info('PICK', `  LLM found no next action — flow complete or dead end`)
        break
      }
      lastIntentCoverage = pick.intentCoverage
      log.info('PICK', `  intentCoverage=${pick.intentCoverage}%  pathSteps=${actionPath.length}`)

      // Guard: stop only if the exact same element AND exact same page state recurs (true infinite loop)
      const elementSetFp = currentElements.map(e => e.id).sort().join(',')
      const stateKey = `${pick.element.id}::${elementSetFp}`
      if (seenStateKeys.has(stateKey)) {
        log.warn('PICK', `  LLM picked same element on identical page state ("${pick.element.name}") — stopping`)
        break
      }
      seenStateKeys.add(stateKey)

      log.step('PICK', `  LLM picked: "${pick.element.name}"  reason: ${pick.reason}`)
      actionPath.push(`click "${pick.element.name}"`)

      // Snapshot visible element IDs before interaction for elementDiff recording
      const beforeInteractionIds = new Set(currentElements.filter(e => e.visible).map(e => e.id))

      const result = await dispatch(
        page, pick.element, currentElements, [pick.element], library, config.headless, pick.element._resolvedValue ?? null
      )
      await waitForIdle(page)
      log.info('INTERACT', `  action=${result.action}  navigated=${result.navigated}  toUrl=${result.toUrl ?? 'none'}`)

      ctx.pathManager.push({
        nodeId: id, url: page.url(),
        decision: {
          elementId: pick.element.id, elementType: pick.element.elementType,
          action: result.action === 'fill' ? 'fill' : result.navigated ? 'click' : 'skip',
          value: null, key: null, source: 'skip',
        },
      })

      // Full navigation → recurse into new page; edge recorded inside runFromPage with the real nodeId
      if (result.navigated && result.toUrl && !isBlocked(result.toUrl)) {
        const trigger = {
          type: (pick.element.elementType === 'link' ? 'link_click' : 'button_click') as 'link_click' | 'button_click',
          semanticType: 'navigate' as const,
          elementId:    pick.element.id,
          elementName:  pick.element.name || null,
          prerequisiteActions: prerequisiteActions.length ? prerequisiteActions : undefined,
        }
        await runFromPage(page, currentNodeId, graph, config, { ...ctx, depth: ctx.depth + 1, phaseBSteps: [], incomingEdge: { fromNodeId: currentNodeId, trigger } })
        return
      }

      // New tab → captureNewTab owns the edge recording with the real post-redirect URL
      if (result.action === 'new_tab' && result.newTab) {
        await captureNewTab(
          result.newTab, currentNodeId, pick.element.id, pick.element.name || null,
          graph, config,
          (p, nid, g, cfg) => runFromPage(p, nid, g, cfg, { ...ctx, depth: ctx.depth + 1, phaseBSteps: [] }),
          ctx.smartLLM
        )
        return
      }

      // Content changed on same page — record new wizard step as a node, re-capture and loop
      if (result.action === 'content_change' || result.action === 'click') {
        log.info('PICK', `  Page content changed — re-capturing elements and continuing flow`)
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
        await waitForIdle(page)
        // Scroll to bottom so off-screen elements (forms revealed below the fold) are rendered
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {})
        await page.waitForTimeout(400)

        // Check for results tables/grids — not interactive so won't appear in capturePageElements
        const resultsMeta = await page.evaluate(() => {
          const tables = document.querySelectorAll('table, [role="grid"], [role="table"]')
          for (const table of Array.from(tables)) {
            const rows = table.querySelectorAll('tr, [role="row"]')
            if (rows.length < 2) continue   // need at least a header + 1 data row
            const headerCells = Array.from(rows[0].querySelectorAll('th, [role="columnheader"]'))
            const headers = headerCells.map(c => (c.textContent || '').trim()).filter(Boolean)
            const dataRows = rows.length - 1
            return { headers, dataRows }
          }
          return null
        }).catch(() => null)

        const resultsNodeIdCheck = resultsMeta ? nodeId(normalizeUrl(page.url()) + '#results') : null
        if (resultsMeta && resultsMeta.dataRows > 0 && resultsNodeIdCheck && !graph.hasNode(resultsNodeIdCheck)) {
          log.info('PICK', `  Results table detected (${resultsMeta.dataRows} rows, cols: ${resultsMeta.headers.join(', ')}) — capturing elements and continuing`)

          const resultsUrl    = page.url()
          const resultsTitle  = await page.title()
          const resultsFp     = `results-${resultsMeta.dataRows}-${resultsMeta.headers.join('|').slice(0, 40)}`
          const resultsNodeId = resultsNodeIdCheck

          // Capture interactive elements on the results page (pagination, sort, row links, etc.)
          const resultsAllElements = await capturePageElements(page, library)
          const nonGlobalResultsElements = resultsAllElements.filter(e => !graph.globalElements.has(e.id))
          const filteredResultsElements = ctx.smartLLM
            ? await filterElements(nonGlobalResultsElements, config.flowName!, resultsUrl, resultsTitle, ctx.smartLLM)
            : nonGlobalResultsElements

          if (!graph.hasNode(resultsNodeId)) {
            const resultsHeading = await getPageHeading(page)
            const resultsPageRef = graph.registerPageRef(resultsHeading || 'Search Results')
            const resultsDescription = `Results table: ${resultsMeta.dataRows} rows, columns: ${resultsMeta.headers.join(', ')}`
            graph.addNode(resultsNodeId, {
              url: resultsUrl, normalizedUrl: normalizeUrl(resultsUrl), title: resultsTitle,
              pageRef: resultsPageRef, description: resultsDescription,
              fingerprint: resultsFp, uiLibrary: library,
              elements: resultsAllElements, unfilledFields: [],
            })
            log.info('GRAPH', `  Results node: ${resultsNodeId}  pageRef="${resultsPageRef}"  rows:${resultsMeta.dataRows}  elements:${resultsAllElements.length}`)
          }
          graph.addEdge({
            from: currentNodeId, to: resultsNodeId,
            trigger: {
              type: 'button_click', semanticType: 'submit_form',
              elementId: pick.element.id, elementName: pick.element.name || null,
              prerequisiteActions: prerequisiteActions.length ? prerequisiteActions : undefined,
            },
          })
          // Amend the last actionPath entry to note results were shown
          if (actionPath.length > 0) {
            actionPath[actionPath.length - 1] += ` → results table shown (${resultsMeta.dataRows} rows)`
          } else {
            actionPath.push(`results table shown (${resultsMeta.dataRows} rows)`)
          }
          currentElements = filteredResultsElements
          currentNodeId   = resultsNodeId
          continue
        }

        const allCaptured = await capturePageElements(page, library)
        const nonGlobalCaptured = allCaptured.filter(e => !graph.globalElements.has(e.id))
        currentElements = await filterElements(nonGlobalCaptured, config.flowName!, page.url(), await page.title(), ctx.smartLLM!)
        log.info('FILTER', `  Re-capture after content change: ${allCaptured.length} total, ${currentElements.length} after filter`)
        currentElements.forEach((e, i) => {
          log.info('FILTER', `    [${String(i + 1).padStart(3)}] ${e.elementType.padEnd(8)} "${e.name}"  selector=${e._selector}`)
        })

        // Compute element diff: which elements appeared/disappeared after this interaction
        const afterInteractionIds = new Set(currentElements.filter(e => e.visible).map(e => e.id))
        const elementDiff = {
          appeared:    [...afterInteractionIds].filter(id => !beforeInteractionIds.has(id)),
          disappeared: [...beforeInteractionIds].filter(id => !afterInteractionIds.has(id)),
        }
        if (elementDiff.appeared.length > 0 || elementDiff.disappeared.length > 0) {
          log.info('DIFF', `  elementDiff: +${elementDiff.appeared.length} appeared, -${elementDiff.disappeared.length} disappeared`)
        }

        // Record wizard step as a distinct node (same URL, different content fingerprint)
        const stepFp      = pageFingerprint(allCaptured.map(e => e.id))
        const stepPageUrl = page.url()
        const stepTitle   = await page.title()
        const stepNodeId  = nodeId(normalizeUrl(stepPageUrl) + '#' + stepFp.slice(0, 8))

        // Validate against prior run's elementDiff if this edge already exists (replay mode)
        const existingEdge = graph.findEdge(currentNodeId, stepNodeId, pick.element.id)
        if (existingEdge?.elementDiff?.appeared && existingEdge.elementDiff.appeared.length > 0) {
          const appeared = existingEdge.elementDiff.appeared
          const passed = appeared.filter(id => afterInteractionIds.has(id))
          const failed = appeared.filter(id => !afterInteractionIds.has(id))
          log.info('VALIDATE', `  Edge validation: ${passed.length}/${appeared.length} expected elements appeared`)
          if (failed.length > 0) {
            log.warn('VALIDATE', `  Missing expected elements: ${failed.join(', ')}`)
          }
          graph.updateEdge(existingEdge.id, {
            validationResult: { passed, failed, timestamp: new Date().toISOString() },
          })
        }

        if (!graph.hasNode(stepNodeId)) {
          const stepHeading = await getPageHeading(page)
          const stepPageRef = graph.registerPageRef(stepHeading)
          graph.addNode(stepNodeId, {
            url: stepPageUrl, normalizedUrl: normalizeUrl(stepPageUrl), title: stepTitle,
            pageRef: stepPageRef,
            fingerprint: stepFp, uiLibrary: library,
            elements: allCaptured, unfilledFields: [],
          })
          log.info('GRAPH', `  Wizard step node: ${stepNodeId}  pageRef="${stepPageRef}"  elements:${allCaptured.length}`)
        }
        graph.addEdge({
          from: currentNodeId, to: stepNodeId,
          trigger: {
            type: pick.element.elementType === 'link' ? 'link_click' : 'button_click',
            semanticType: 'reveal_content',
            elementId:    pick.element.id,
            elementName:  pick.element.name || null,
            prerequisiteActions: prerequisiteActions.length ? prerequisiteActions : undefined,
          },
          elementDiff,
        })
        currentNodeId = stepNodeId   // advance: next edge chains from this step

        continue
      }

      // skip / no change — stop
      break
    }

    // Store path-vs-intent result on the graph so index.ts can merge into eval after runEval()
    if (actionPath.length > 0) {
      graph.setPathIntent(lastIntentCoverage, actionPath)
      log.info('PICK', `  Flow path recorded: ${actionPath.length} steps  finalIntentCoverage=${lastIntentCoverage}%`)
    }

  } else {
    // ── BFS mode (no flowName) — process all elements ───────────────────────────
    const overlayElements = elements.filter(e => e.blocked)
    const pageElements    = elements.filter(e => !e.blocked)
    const orderedElements = [...overlayElements, ...pageElements]

    const radioGroups = new Map<string, CapturedElement[]>()
    for (const el of orderedElements) {
      if (el.elementType === 'radio') {
        const groupName = el.name || el.id
        const group = radioGroups.get(groupName) ?? []
        group.push(el)
        radioGroups.set(groupName, group)
      }
    }
    const processedRadioGroups = new Set<string>()
    const interactionQueue = [...orderedElements]

    while (interactionQueue.length > 0) {
      const element = interactionQueue.shift()!
      if (!element._selector) continue

      let resolvedValue: string | null = null
      let fillKey: string | null = null
      let fillSource: CapturedElement['fillSource'] = null
      let fillConfidence: number | null = null

      if (element.elementType === 'textbox' || element.elementType === 'textarea') {
        const fillResult = await resolveValue(
          element, ctx.excelData, ctx.notes, ctx.cache, ctx.smartLLM, config, normUrl
        )
        resolvedValue = fillResult.value
        fillKey = fillResult.key
        fillSource = fillResult.source
        fillConfidence = fillResult.confidence
        element.interactionKey = fillKey
        element.fillSource = fillSource
        element.fillConfidence = fillConfidence
        element._resolvedValue = resolvedValue
        if (fillResult.source === 'cache') graph.incrementCacheHits()
      }

      if (element.elementType === 'radio') {
        const groupName = element.name || element.id
        if (processedRadioGroups.has(groupName)) continue
        processedRadioGroups.add(groupName)
        const group = radioGroups.get(groupName) ?? [element]
        if (group.length > 1) {
          for (let i = 1; i < group.length; i++) {
            const alt = group[i]
            ctx.branchQueue.enqueue({
              pathId: ctx.pathManager.pathId() + `-radio-${alt.id}`,
              divergeNodeId: id, divergeStepIdx: ctx.pathManager.length,
              altValue: alt.name, altKey: alt.id, elementId: alt.id,
              steps: ctx.pathManager.getActivePath(),
            })
          }
        }
      }

      log.step('INTERACT', `  → ${element.elementType.padEnd(8)} "${element.name}"  selector=${element._selector}`)
      const result = await dispatch(
        page, element, orderedElements,
        radioGroups.get(element.name || element.id) ?? [element],
        library, config.headless, resolvedValue
      )
      await waitForIdle(page)
      log.info('INTERACT', `     action=${result.action}  navigated=${result.navigated}  toUrl=${result.toUrl ?? 'none'}`)

      ctx.pathManager.push({
        nodeId: id, url,
        decision: {
          elementId: element.id, elementType: element.elementType,
          action: result.action === 'fill' ? 'fill' : result.navigated ? 'click' : 'skip',
          value: resolvedValue, key: fillKey, source: fillSource ?? 'skip',
        },
      })

      if (result.navigated && result.toUrl) {
        if (isBlocked(result.toUrl)) continue
        const triggerType = element.elementType === 'link' ? 'link_click'
          : element.elementType === 'button' ? 'button_click'
          : element.elementType === 'tab'    ? 'tab_click' : 'js_navigation'
        // Edge recorded inside runFromPage so it uses the real fingerprint-based nodeId
        const trigger = {
          type: triggerType, semanticType: 'navigate',
          elementId: element.id, elementName: element.name || null,
        } as const
        await runFromPage(page, id, graph, config, { ...ctx, depth: ctx.depth + 1, phaseBSteps: [], incomingEdge: { fromNodeId: id, trigger } })
        return
      }

      if (result.action === 'new_tab' && result.newTab) {
        await captureNewTab(
          result.newTab, id, element.id, element.name || null, graph, config,
          (p, nid, g, cfg) => runFromPage(p, nid, g, cfg, { ...ctx, depth: ctx.depth + 1, phaseBSteps: [] }),
          ctx.smartLLM
        )
      }

      if (result.newElements.length > 0) {
        interactionQueue.unshift(...result.newElements)
      }
    }
  }

  // Route prediction at dead end — BFS mode only; focused-flow has a single known path
  if (!config.flowName && config.routePredictionEnabled !== false && ctx.smartLLM && graph.nodeCount < config.maxPages) {
    try {
      const predictions = await predictRoutes({
        currentGraph:  graph.toJSON(),
        alreadyWalked: ctx.pathManager.getCompletedPaths(),
        maxRoutes:     5,
      }, ctx.smartLLM)
      if (predictions.length > 0) {
        log.info('PREDICT', `${predictions.length} route(s) predicted — queuing`)
        for (const route of predictions) ctx.branchQueue.addPredicted(route)
        graph.incrementPredictedRoutes(predictions.length)
      }
    } catch (err: any) {
      log.warn('PREDICT', `Route prediction failed: ${err.message}`)
    }
  }

  await cleanupCrawlerAttrs(page)

  // Update node with full element set (not the LLM-filtered subset)
  graph.updateNode(id, { elements: allElements })
}

export async function runCrawlLoop(
  context: BrowserContext,
  config: CrawlerConfig,
  graph: CrawlerGraph,
  excelData: ExcelData,
  notes: ParsedNotes,
  cache: CrawlDataCache,
  smartLLM: BaseChatModel | null,
  fastLLM: BaseChatModel | null,
  existingNodes: Record<string, Node> = {},
): Promise<void> {
  const branchQueue  = new BranchQueue()
  const pathManager  = new PathManager()

  // ── Initial Phase A crawl ───────────────────────────────────────────────────
  const page = await context.newPage()
  try {
    log.info('CRAWL', `Navigating to seed: ${config.seedUrl}`)
    const gotoResp = await page.goto(config.seedUrl, { waitUntil: 'networkidle', timeout: 30000 }).catch((err: Error) => {
      log.warn('CRAWL', `goto error: ${err.message}`)
      return null
    })
    log.info('CRAWL', `goto response status: ${gotoResp?.status() ?? 'null'}  url: ${page.url()}`)
    log.info('CRAWL', `page title: "${await page.title()}"`)
    const bodySnippet = await page.evaluate(() => document.body?.innerText?.slice(0, 300) ?? '').catch(() => '')
    log.info('CRAWL', `body snippet: ${bodySnippet.replace(/\n/g, ' ')}`)
    await runFromPage(page, nodeId(normalizeUrl(config.seedUrl)), graph, config, {
      excelData, notes, cache, smartLLM, fastLLM,
      branchQueue, pathManager, phaseBSteps: [], depth: 0, existingNodes,
    })
    pathManager.markComplete()
  } finally {
    await page.close()
  }

  // ── Phase B: re-trace pending branches (BFS mode only) ────────────────────
  // Focused-flow mode has a single deterministic path — no alternates to replay.
  if (config.flowName) return
  while (!branchQueue.isEmpty) {
    const branch = branchQueue.dequeue()!

    const bPage = await context.newPage()
    try {
      await bPage.goto(config.seedUrl, { waitUntil: 'networkidle', timeout: 30000 })

      const branchPathManager = new PathManager()
      branchPathManager.reset(branch.steps)

      await runFromPage(bPage, nodeId(normalizeUrl(config.seedUrl)), graph, config, {
        excelData, notes, cache, smartLLM, fastLLM,
        branchQueue, pathManager: branchPathManager,
        phaseBSteps: branch.steps, depth: 0, existingNodes,
      })
      branchPathManager.markComplete()
    } catch (err: any) {
      log.warn('BRANCH', `Branch failed: ${err.message}`)
    } finally {
      await bPage.close()
    }
  }
}
