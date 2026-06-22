import { z } from 'zod'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { CapturedElement } from '../types.js'
import { log } from '../logger.js'

const PickSchema = z.object({
  elementId: z.string().nullable(),
  reason:    z.string(),
  flowDone:  z.boolean(),
})

export interface PickResult {
  element: CapturedElement
  reason:  string
}

export async function pickNextAction(
  elements:     CapturedElement[],   // non-form navigation candidates
  flowName:     string,
  url:          string,
  title:        string,
  llm:          BaseChatModel,
  filledFields: string[] = [],       // form field labels filled in this iteration
): Promise<PickResult | null> {
  if (elements.length === 0) return null

  const elList = elements.map(e =>
    `id=${e.id}  tag=${e.tag}  label="${e.name}"  selector=${e._selector}${e.href ? `  href=${e.href}` : ''}`
  ).join('\n')

  const filledContext = filledFields.length > 0
    ? `\nForm fields just filled this step: ${filledFields.join(', ')}.
IMPORTANT: These fields belong to a form that must be submitted before navigating anywhere else.
Pick the submit/action button for this form (e.g. Login, Submit, Continue, Sign In) — NOT a navigation link.\n`
    : ''

  const prompt =
    `You are navigating a web app to complete the "${flowName}" flow.

Page URL: ${url}
Page title: ${title}
${filledContext}
Clickable elements (buttons, links, tabs):
${elList}

Pick the ONE element that best represents the next step toward "${flowName}".
Rules:
- You MUST pick an element (set elementId to a valid id from the list) unless the flow is 100% finished.
- If form fields were just filled (listed above), always submit that form first before any other navigation.
- Prefer elements whose label directly matches the flow name or a step in it.
- If a dialog/overlay is present (Accept, Continue, Close), always pick that first.
- Set flowDone=true ONLY if the current page shows a clear completion state (confirmation message, success banner, summary of completed action). A login page, home page, or form page is NEVER a completion state.
- Set elementId=null ONLY if absolutely no element in the list has any connection to the flow — this should be extremely rare.
Return the exact element id from the list above.`

  try {
    const result = await llm.withStructuredOutput(PickSchema).invoke(prompt)
    if (result.flowDone) return null
    if (!result.elementId) {
      // LLM returned null despite having candidates — fall back to first element ranked by label match
      log.warn('PICK', `LLM returned null elementId with ${elements.length} candidates — using best-match fallback`)
      const flowWords = flowName.toLowerCase().split(/\s+/)
      const scored = elements.map(e => {
        const label = e.name.toLowerCase()
        const score = flowWords.filter(w => label.includes(w)).length
        return { element: e, score }
      }).sort((a, b) => b.score - a.score)
      return { element: scored[0].element, reason: 'label-match fallback (LLM returned null)' }
    }
    const match = elements.find(e => e.id === result.elementId)
    if (!match) return null
    return { element: match, reason: result.reason }
  } catch (err: any) {
    log.warn('PICK', `LLM pick failed: ${err.message}`)
    return elements.length > 0 ? { element: elements[0], reason: 'LLM unavailable' } : null
  }
}
