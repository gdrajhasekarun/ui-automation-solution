import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { ChatPromptTemplate } from '@langchain/core/prompts'
import type { CapturedElement, FieldReasoning, ParsedNotes } from '../types.js'
import { FieldReasoningSchema } from '../types.js'

export async function reasonFields(
  elements: CapturedElement[],
  notes: ParsedNotes,
  llm: BaseChatModel,
  confidenceThreshold: number,
): Promise<FieldReasoning> {
  const fillable = elements.filter(e =>
    (e.elementType === 'textbox' || e.elementType === 'textarea') && !e.blocked
  )
  if (fillable.length === 0) return { fields: [] }

  const elementSummary = fillable.map(e =>
    `id=${e.id} name="${e.name}" label="${e.label ?? ''}" placeholder="${e.placeholder ?? ''}" required=${e.required} type=${e.inputType ?? 'text'}`
  ).join('\n')

  const hintsStr = Object.entries(notes.fieldHints)
    .map(([k, v]) => `${k}: ${v}`).join('\n') || '(none)'

  const rulesStr = notes.generalRules.join('\n') || '(none)'

  try {
    const prompt = ChatPromptTemplate.fromMessages([
      ['system', `You are a web form filler for automated UI testing.
For each form field, determine an appropriate test value.
Return a normalised snake_case key (e.g. "uk_postcode", "email_address") that can be reused across pages.
Confidence 0.0–1.0: use >0.9 only when you are certain about format/value.
Fields with confidence below ${confidenceThreshold} should use an empty string for value.`],
      ['human', `Crawl notes hints:
{hints}

General rules:
{rules}

Form fields on this page:
{elements}

Return JSON with fields array.`],
    ])

    const structured = (llm as any).withStructuredOutput(FieldReasoningSchema)
    const chain = prompt.pipe(structured)
    return await chain.invoke({ hints: hintsStr, rules: rulesStr, elements: elementSummary }) as FieldReasoning
  } catch {
    return { fields: [] }
  }
}
