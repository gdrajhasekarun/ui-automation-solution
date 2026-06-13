import * as fs from 'fs'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { ChatPromptTemplate } from '@langchain/core/prompts'
import { ParsedNotesSchema, type ParsedNotes } from '../types.js'

export async function parseNotes(notesPath: string, llm: BaseChatModel): Promise<ParsedNotes> {
  const empty: ParsedNotes = { generalRules: [], skipSelectors: [], fieldHints: {} }

  if (!fs.existsSync(notesPath)) return empty

  const content = fs.readFileSync(notesPath, 'utf8').trim()
  if (!content) return empty

  try {
    const prompt = ChatPromptTemplate.fromMessages([
      ['system', `You are a crawl configuration parser.
Parse the provided crawl-notes.md and extract structured instructions.
Return JSON with:
- generalRules: array of natural language rules for the crawler
- skipSelectors: CSS selectors / keywords of elements to skip (logout, delete, etc.)
- fieldHints: record of field name/type to suggested value (e.g. "postcode": "SW1A 1AA")
- loginInstructions: optional string describing how to handle login`],
      ['human', '{notes}'],
    ])

    const structured = (llm as any).withStructuredOutput(ParsedNotesSchema)
    const chain = prompt.pipe(structured)
    return await chain.invoke({ notes: content }) as ParsedNotes
  } catch {
    return empty
  }
}
