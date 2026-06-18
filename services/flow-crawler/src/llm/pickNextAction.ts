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
- If form fields were just filled (listed above), always submit that form first before any other navigation.
- Prefer elements whose label directly matches the flow name or a step in it.
- If a dialog/overlay is present (Accept, Continue, Close), always pick that first.
- Set flowDone=true only if the flow destination has already been reached and there is nothing more to click.
- Set elementId=null only if no element is relevant at all (dead end).
Return the exact element id from the list above.`

  try {
    const result = await llm.withStructuredOutput(PickSchema).invoke(prompt)
    if (result.flowDone || !result.elementId) return null
    const match = elements.find(e => e.id === result.elementId)
    if (!match) return null
    return { element: match, reason: result.reason }
  } catch (err: any) {
    log.warn('PICK', `LLM pick failed: ${err.message}`)
    return elements.length > 0 ? { element: elements[0], reason: 'LLM unavailable' } : null
  }
}
