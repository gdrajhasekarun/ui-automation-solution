import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { ChatPromptTemplate } from '@langchain/core/prompts'
import type { CapturedElement, FieldReasoning, ParsedNotes } from '../types.js'
import { FieldReasoningSchema } from '../types.js'

export async function reasonFields(
  elements: CapturedElement[],
  notes: ParsedNotes,
  llm: BaseChatModel,
  confidenceThreshold: number,
  flowName?: string,
): Promise<FieldReasoning> {
  const fillable = elements.filter(e =>
    (e.elementType === 'textbox' || e.elementType === 'textarea' || e.elementType === 'select' || e.elementType === 'combobox') && !e.blocked
  )
  if (fillable.length === 0) return { fields: [] }

  const elementSummary = fillable.map(e => {
    let line = `id=${e.id} name="${e.name}" label="${e.label ?? ''}" placeholder="${e.placeholder ?? ''}" required=${e.required} type=${e.elementType}`
    if (e._selectOptions?.length) line += ` options=[${e._selectOptions.map(o => `"${o}"`).join(', ')}]`
    return line
  }).join('\n')

  const hintsStr = Object.entries(notes.fieldHints)
    .map(([k, v]) => `${k}: ${v}`).join('\n') || '(none)'

  const rulesStr = notes.generalRules.join('\n') || '(none)'

  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
  const flowContext = flowName
    ? `\nActive user flow: "${flowName}" — values must be realistic and relevant to this flow.`
    : ''
  const dateContext = `\nToday's date is ${today}. Use this as the reference point when choosing values for any date fields — follow the flow's intent (past, present, or future).`

  try {
    const prompt = ChatPromptTemplate.fromMessages([
      ['system', `You are a web form filler for automated UI testing.
For each form field, determine an appropriate test value.
Return a normalised snake_case key (e.g. "uk_postcode", "email_address") that can be reused across pages.
Confidence 0.0–1.0: use >0.9 only when you are certain about format/value.
Fields with confidence below ${confidenceThreshold} should use an empty string for value.
For select/combobox fields that list options, you MUST pick one of the provided option values exactly as written.${flowContext}${dateContext}`],
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
