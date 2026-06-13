import type { Page, BrowserContext } from 'playwright'
import type { CrawlerConfig, CapturedElement, PathStep, ParsedNotes, Branch, Node } from '../types.js'
import type { CrawlerGraph } from '../graph/index.js'
import type { ExcelData } from '../data/index.js'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { normalizeUrl, nodeId, pageFingerprint } from '../graph/index.js'
import { capturePageElements, detectUILibrary, findNewElements, cleanupCrawlerAttrs } from '../capture/index.js'
import { dispatch, safeClick, waitForIdle } from '../interaction/index.js'
import { recordEdge, captureNewTab } from '../navigation/index.js'
import { resolveValue } from '../data/index.js'
import { filterElements, pickNextAction, namePageRef } from '../llm/index.js'
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
  let elements = await capturePageElements(page, library)
  const title = await page.title()

  // When the same URL appears with different content (wizard steps), use element fingerprint
  // to create distinct node IDs so each step is captured separately in the graph.
  const fp  = pageFingerprint(elements.map(e => e.id))
  const baseId = nodeId(normUrl)
  const id  = graph.hasNode(baseId) && graph.getNode(baseId)?.fingerprint !== fp
    ? nodeId(normUrl + '#' + fp.slice(0, 8))
    : baseId

  log.step('CAPTURE', `[depth:${ctx.depth}] "${title || normUrl}"  library:${library}  elements:${elements.length}  node:${id}`)

  // Log all captured elements (mirrors crawl-ai FLOW_TRACE format)
  elements.forEach((e, i) => {
    log.info('CAPTURE', `  [${String(i + 1).padStart(3)}] tag=${e.tag.padEnd(8)} type=${e.elementType.padEnd(8)} label="${e.name}"  selector=${e._selector}`)
  })

  // Register node if new, always update elements so they're captured in the graph
  if (!graph.hasNode(id)) {
    const pageRef = ctx.smartLLM
      ? await namePageRef(title, url, elements, ctx.smartLLM, ctx.existingNodes, graph.usedPageRefNames)
          .then(r => { graph.incrementLLMCalls(); return graph.registerPageRef(r) })
      : graph.registerPageRef(title)
    graph.addNode(id, {
      url, normalizedUrl: normUrl, title, pageRef,
      fingerprint: fp, uiLibrary: library,
      elements, unfilledFields: [],
    })
  } else {
    graph.updateNode(id, { elements })
  }

  // ── LLM element filter (Phase A only) ──────────────────────────────────────
  if (config.flowName && ctx.smartLLM && ctx.phaseBSteps.length === 0) {
    const before = elements.length
    elements = await filterElements(elements, config.flowName, url, title, ctx.smartLLM)
    log.info('FILTER', `LLM filter "${config.flowName}": ${before} → ${elements.length} elements kept`)
    elements.forEach((e, i) => {
      log.info('FILTER', `  [${String(i + 1).padStart(3)}] tag=${e.tag.padEnd(8)} type=${e.elementType.padEnd(8)} label="${e.name}"  selector=${e._selector}`)
    })
    graph.incrementLLMCalls()
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

    while (iterations++ < MAX_SAME_PAGE_ITERS) {
      // Step 1: fill all form fields (including combobox/select dropdowns)
      const formFields = currentElements.filter(e =>
        e.elementType === 'textbox' || e.elementType === 'textarea' ||
        e.elementType === 'select'  || e.elementType === 'combobox'
      )
      for (const element of formFields) {
        if (!element._selector) continue

        // Skip pre-populated fields
        const currentVal = await page.evaluate((sel) => {
          const el = document.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null
          return el ? (el as HTMLInputElement).value?.trim() ?? '' : ''
        }, element._selector).catch(() => '')
        if (currentVal) {
          log.info('INTERACT', `  → skip     "${element.name}"  (pre-populated: "${currentVal}")`)
          continue
        }

        const fillResult = await resolveValue(
          element, ctx.excelData, ctx.notes, ctx.cache,
          ctx.smartLLM, config, normUrl
        )

        let valueToFill = fillResult.value

        // Combobox/select fallback: if no resolved value, pick first available option
        if (!valueToFill && (element.elementType === 'combobox' || element.elementType === 'select')) {
          const firstOption = await page.evaluate((sel) => {
            // Native <select>
            const select = document.querySelector(sel) as HTMLSelectElement | null
            if (select?.tagName === 'SELECT') {
              const opt = Array.from(select.options).find(o => o.value && o.value !== '')
              return opt?.text?.trim() ?? null
            }
            // mat-select / custom combobox: open it and read mat-option text
            return null
          }, element._selector).catch(() => null)

          if (firstOption) {
            valueToFill = firstOption
            fillResult.source = 'cache'  // treat as auto-selected, no LLM cost
            log.info('INTERACT', `  → auto-select "${element.name}"  first option="${firstOption}"`)
          } else {
            // For Angular Material mat-select: click to open then pick first mat-option
            try {
              await safeClick(page, element._selector)
              await page.waitForTimeout(500)
              const matOption = await page.locator('mat-option').first().textContent({ timeout: 2000 }).catch(() => null)
              if (matOption?.trim()) {
                valueToFill = matOption.trim()
                await page.locator('mat-option').first().click()
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
          await dispatch(page, element, currentElements, [element], library, config.headless, valueToFill)
          await waitForIdle(page)
          if (fillResult.source === 'llm' || fillResult.source === 'excel') graph.incrementLLMCalls()
          else if (fillResult.source === 'cache') graph.incrementCacheHits()
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
        !disabledSelectors.includes((e.name ?? '').toLowerCase().slice(0, 60))
      )
      log.info('PICK', `  [iter ${iterations}] Asking LLM to pick next action from ${navCandidates.length} candidates for flow "${config.flowName}"`)
      navCandidates.forEach((e, i) => {
        log.info('PICK', `    [${String(i + 1).padStart(3)}] ${e.elementType.padEnd(8)} "${e.name}"  selector=${e._selector}`)
      })

      const pick = await pickNextAction(navCandidates, config.flowName, page.url(), await page.title(), ctx.smartLLM)
      graph.incrementLLMCalls()

      if (!pick) {
        log.info('PICK', `  LLM found no next action — flow complete or dead end`)
        break
      }

      // Guard: stop only if the exact same element AND exact same page state recurs (true infinite loop)
      const elementSetFp = currentElements.map(e => e.id).sort().join(',')
      const stateKey = `${pick.element.id}::${elementSetFp}`
      if (seenStateKeys.has(stateKey)) {
        log.warn('PICK', `  LLM picked same element on identical page state ("${pick.element.name}") — stopping`)
        break
      }
      seenStateKeys.add(stateKey)

      log.step('PICK', `  LLM picked: "${pick.element.name}"  reason: ${pick.reason}`)

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

      // Full navigation → recurse into new page
      if (result.navigated && result.toUrl && !isBlocked(result.toUrl)) {
        recordEdge(graph, currentNodeId, result.toUrl, {
          type: pick.element.elementType === 'link' ? 'link_click' : 'button_click',
          semanticType: 'navigate', elementId: pick.element.id, elementName: pick.element.name || null,
        })
        await runFromPage(page, currentNodeId, graph, config, { ...ctx, depth: ctx.depth + 1, phaseBSteps: [] })
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
        currentElements = await capturePageElements(page, library)
        currentElements = await filterElements(currentElements, config.flowName!, page.url(), await page.title(), ctx.smartLLM!)
        log.info('FILTER', `  Re-filter after content change: ${currentElements.length} elements`)
        currentElements.forEach((e, i) => {
          log.info('FILTER', `    [${String(i + 1).padStart(3)}] ${e.elementType.padEnd(8)} "${e.name}"  selector=${e._selector}`)
        })
        graph.incrementLLMCalls()

        // Record wizard step as a distinct node (same URL, different content fingerprint)
        const stepFp      = pageFingerprint(currentElements.map(e => e.id))
        const stepPageUrl = page.url()
        const stepTitle   = await page.title()
        const stepNodeId  = nodeId(normalizeUrl(stepPageUrl) + '#' + stepFp.slice(0, 8))
        if (!graph.hasNode(stepNodeId)) {
          const stepPageRef = ctx.smartLLM
            ? await namePageRef(stepTitle, stepPageUrl, currentElements, ctx.smartLLM, ctx.existingNodes, graph.usedPageRefNames)
                .then(r => { graph.incrementLLMCalls(); return graph.registerPageRef(r) })
            : graph.registerPageRef(stepTitle)
          graph.addNode(stepNodeId, {
            url: stepPageUrl, normalizedUrl: normalizeUrl(stepPageUrl), title: stepTitle, pageRef: stepPageRef,
            fingerprint: stepFp, uiLibrary: library,
            elements: currentElements, unfilledFields: [],
          })
          log.info('GRAPH', `  Wizard step node: ${stepNodeId}  pageRef="${stepPageRef}"  elements:${currentElements.length}`)
        }
        graph.addEdge({
          from: currentNodeId, to: stepNodeId,
          trigger: {
            type: pick.element.elementType === 'link' ? 'link_click' : 'button_click',
            semanticType: 'reveal_content',
            elementId: pick.element.id, elementName: pick.element.name || null,
          },
        })
        currentNodeId = stepNodeId   // advance: next edge chains from this step

        continue
      }

      // skip / no change — stop
      break
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
        if (fillResult.source === 'llm' || fillResult.source === 'excel') graph.incrementLLMCalls()
        else if (fillResult.source === 'cache') graph.incrementCacheHits()
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
        recordEdge(graph, id, result.toUrl, {
          type: triggerType, semanticType: 'navigate',
          elementId: element.id, elementName: element.name || null,
        })
        await runFromPage(page, id, graph, config, { ...ctx, depth: ctx.depth + 1, phaseBSteps: [] })
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

  await cleanupCrawlerAttrs(page)

  // Update node with final element state
  graph.updateNode(id, { elements })
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
    await page.goto(config.seedUrl, { waitUntil: 'networkidle', timeout: 30000 })
    await runFromPage(page, nodeId(normalizeUrl(config.seedUrl)), graph, config, {
      excelData, notes, cache, smartLLM, fastLLM,
      branchQueue, pathManager, phaseBSteps: [], depth: 0, existingNodes,
    })
    pathManager.markComplete()
  } finally {
    await page.close()
  }

  // ── Phase B: re-trace pending branches ─────────────────────────────────────
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
