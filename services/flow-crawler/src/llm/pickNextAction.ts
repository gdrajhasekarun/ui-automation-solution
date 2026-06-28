import { z } from 'zod'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { CapturedElement } from '../types.js'
import { log } from '../logger.js'

const PickSchema = z.object({
  elementId:      z.string().nullable(),
  reason:         z.string(),
  flowDone:       z.boolean(),
  intentCoverage: z.number().min(0).max(100),
})

export interface PickResult {
  element:        CapturedElement
  reason:         string
  intentCoverage: number
}

export async function pickNextAction(
  elements:     CapturedElement[],   // non-form navigation candidates
  flowName:     string,
  url:          string,
  title:        string,
  llm:          BaseChatModel,
  filledFields: string[] = [],       // form field labels filled in this iteration
  pathSoFar:    string[] = [],       // ordered list of actions already taken in this flow
): Promise<PickResult | null> {
  if (elements.length === 0) return null

  const elList = elements.map(e =>
    `id=${e.id}  tag=${e.tag}  label="${e.name}"  selector=${e._selector}${e.href ? `  href=${e.href}` : ''}`
  ).join('\n')

  const filledContext = filledFields.length > 0
    ? `\nForm fields filled in the current iteration: ${filledFields.join(', ')}.\n`
    : ''

  const pathContext = pathSoFar.length > 0
    ? `\nSteps already completed toward this flow:\n${pathSoFar.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}\n`
    : ''

  const prompt =
    `You are navigating a web app to complete the "${flowName}" flow.

Page URL: ${url}
Page title: ${title}
${pathContext}${filledContext}
Clickable elements (buttons, links, tabs):
${elList}

Pick the ONE element that best represents the next step toward "${flowName}".
Rules:
- ALWAYS start by evaluating the completed steps list. Determine whether the flow goal has already been achieved based on what those steps accomplished, regardless of what fields are currently visible on the page.
- Set flowDone=true and intentCoverage=100 if the completed steps show the flow goal has been fully achieved. Do NOT re-submit or re-execute an action whose outcome already fulfilled the goal.
- If the flow is not yet done and form fields were filled in the current iteration, pick the appropriate submit/action button for that form next.
- If a dialog/overlay is present (Accept, Continue, Close), always pick that first.
- Prefer elements whose label directly matches the flow name or a step in it.
- Do NOT pick an element that was already successfully executed in the completed steps unless the flow explicitly requires repeating it.
- On a product detail page: if "Add to cart", "Buy", or "Get it now" is present, ALWAYS prefer it over pagination, color/size pickers, or promotional links to advance a purchase flow.
- Set elementId=null ONLY if absolutely no element in the list has any connection to the flow — this should be extremely rare.
Also set intentCoverage to an integer 0–100 representing how much of the flow goal has been accomplished based on the completed steps (100 = fully done).
Return the exact element id from the list above.`

  try {
    const result = await llm.withStructuredOutput(PickSchema).invoke(prompt)
    if (result.flowDone) return null
    if (!result.elementId) {
      log.warn('PICK', `LLM returned null elementId with ${elements.length} candidates — using best-match fallback`)
      const flowWords = flowName.toLowerCase().split(/\s+/)
      const scored = elements.map(e => {
        const label = e.name.toLowerCase()
        const score = flowWords.filter(w => label.includes(w)).length
        return { element: e, score }
      }).sort((a, b) => b.score - a.score)
      return { element: scored[0].element, reason: 'label-match fallback (LLM returned null)', intentCoverage: result.intentCoverage ?? 0 }
    }
    const match = elements.find(e => e.id === result.elementId)
    if (!match) return null
    return { element: match, reason: result.reason, intentCoverage: result.intentCoverage ?? 0 }
  } catch (err: any) {
    log.warn('PICK', `LLM pick failed: ${err.message}`)
    return elements.length > 0 ? { element: elements[0], reason: 'LLM unavailable', intentCoverage: 0 } : null
  }
}
