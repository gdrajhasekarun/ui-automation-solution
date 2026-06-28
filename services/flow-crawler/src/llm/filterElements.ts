import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { ChatPromptTemplate } from '@langchain/core/prompts'
import type { CapturedElement } from '../types.js'
import { FilteredElementsSchema } from '../types.js'
import { log } from '../logger.js'

// Labels that signal a consent/license gate that must be dismissed before the main flow
const GATE_PATTERN = /^(accept|agree|i accept|i agree|ok|okay|got it|continue|proceed|acknowledge|confirm|close|dismiss|allow|enable)/i

export async function filterElements(
  elements: CapturedElement[],
  flowName: string,
  url: string,
  title: string,
  llm: BaseChatModel,
): Promise<CapturedElement[]> {
  if (!flowName || elements.length === 0) return elements

  // Always keep consent/license gate buttons — they block the main flow regardless of relevance
  const gateElements = elements.filter(e =>
    (e.elementType === 'button' || e.elementType === 'link') && GATE_PATTERN.test((e.label ?? e.name).trim())
  )
  const gateIds = new Set(gateElements.map(e => e.id))

  // Always keep radio/checkbox — the radio auto-fill step depends on them being present
  const alwaysKeepIds = new Set(
    elements.filter(e => e.elementType === 'radio' || e.elementType === 'checkbox').map(e => e.id)
  )

  const elementSummary = elements.map(e =>
    `id=${e.id} type=${e.elementType} name="${e.name}" label="${e.label ?? ''}" required=${e.required}`
  ).join('\n')

  try {
    const prompt = ChatPromptTemplate.fromMessages([
      ['system', `You are a UI flow analyst for a web crawler.
Given a list of interactive elements on a page and a user-specified flow name,
return only the element IDs that are relevant to progressing through that flow.
A flow is a named user journey e.g. "checkout", "user registration", "login".
Be conservative — include an element if you are unsure rather than exclude it.
Always include:
- Any submit, continue, next, or proceed buttons
- Any accept, agree, or license/consent buttons (these are prerequisite gates that must be dismissed before the main flow can continue)`],
      ['human', `Flow name: {flowName}
Page URL: {url}
Page title: {title}

Elements:
{elements}

Return JSON with relevantElementIds array and brief reasoning.`],
    ])

    const structured = (llm as any).withStructuredOutput(FilteredElementsSchema)
    const chain = prompt.pipe(structured)
    const result = await chain.invoke({ flowName, url, title, elements: elementSummary }) as { relevantElementIds: string[] }

    const relevant = new Set(result.relevantElementIds)
    return elements.filter(e => relevant.has(e.id) || gateIds.has(e.id) || alwaysKeepIds.has(e.id) || e.blocked)
  } catch (err: any) {
    log.warn('FILTER', `LLM filter failed: ${err.message}`)
    return elements
  }
}
