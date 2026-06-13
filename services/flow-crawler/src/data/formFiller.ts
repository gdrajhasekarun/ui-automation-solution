import type { CapturedElement, ParsedNotes, CrawlerConfig } from '../types.js'
import type { ExcelData } from './excelReader.js'
import type { CrawlDataCache } from '../cache/index.js'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { reasonFields } from '../llm/index.js'
import { CrawlDataCache as Cache } from '../cache/index.js'
import { log } from '../logger.js'

export interface FillResult {
  value:      string | null
  key:        string | null
  source:     CapturedElement['fillSource']
  confidence: number | null
}

export async function resolveValue(
  element: CapturedElement,
  excelData: ExcelData,
  notes: ParsedNotes,
  cache: CrawlDataCache,
  llm: BaseChatModel | null,
  config: CrawlerConfig,
  normalizedUrl: string,
  accountId?: string,
): Promise<FillResult> {
  const type = element.elementType
  if (type !== 'textbox' && type !== 'textarea' && type !== 'select' && type !== 'combobox') return noFill()

  const elementName = element.name.toLowerCase().replace(/\s+/g, '_')

  // Level 1: Excel FormFills exact match
  log.info('FILL', `Resolving "${element.name}" (${type})  name="${elementName}"  label="${element.label ?? ''}"  placeholder="${element.placeholder ?? ''}"`)
  log.info('FILL', `  Excel FormFills available (${excelData.formFills.length}):`)
  excelData.formFills.forEach(row => {
    const matches = elementMatchesKey(element, row.field_match)
    log.info('FILL', `    field_match="${row.field_match}"  value="${row.value}"  → ${matches ? 'MATCH' : 'no match'}`)
  })

  const excelMatch = excelData.formFills.find(row => {
    if (row.account_id && row.account_id !== accountId) return false
    return elementMatchesKey(element, row.field_match)
  })
  if (excelMatch) {
    const key = excelMatch.field_match
    log.info('FILL', `  → Excel match: "${key}" = "${excelMatch.value}"`)
    return { value: excelMatch.value, key, source: 'excel', confidence: 1.0 }
  }

  // Level 2: crawl-notes.md fieldHints
  for (const [hint, value] of Object.entries(notes.fieldHints)) {
    if (elementMatchesKey(element, hint)) {
      return { value, key: hint, source: 'notes', confidence: 0.9 }
    }
  }

  // Level 3: Cache lookup
  const cacheKey = Cache.buildKey({ normalizedUrl, elementName, elementType: type })
  const cached = await cache.get(cacheKey)
  if (cached) {
    return { value: cached.value, key: cached.key, source: 'cache', confidence: cached.confidence }
  }

  // Level 4: Static fallback by input type
  const staticValue = staticFallback(element)
  if (staticValue !== null) {
    return { value: staticValue, key: cacheKey, source: 'static', confidence: 0.6 }
  }

  // Level 5: LLM
  if (llm) {
    const reasoning = await reasonFields([element], notes, llm, config.llm.confidenceThreshold)
    const field = reasoning.fields[0]
    if (field && field.value && field.confidence >= config.llm.confidenceThreshold) {
      const llmKey = field.key
      await cache.set(llmKey, {
        key: llmKey, value: field.value, source: 'llm',
        confidence: field.confidence, elementType: type,
        usageCount: 1, lastUsed: new Date().toISOString(),
      })
      log.info('FILL', `LLM resolved "${llmKey}" → "${field.value}" (confidence: ${field.confidence})`)
      return { value: field.value, key: llmKey, source: 'llm', confidence: field.confidence }
    }
  }

  return noFill()
}

function elementMatchesKey(element: CapturedElement, key: string): boolean {
  const k = key.toLowerCase()
  const name = element.name.toLowerCase()
  const label = (element.label ?? '').toLowerCase()
  const placeholder = (element.placeholder ?? '').toLowerCase()
  return name.includes(k) || label.includes(k) || placeholder.includes(k) || k.includes(name)
}

function staticFallback(element: CapturedElement): string | null {
  const type = (element.inputType || '').toLowerCase()
  const name = element.name.toLowerCase()
  if (type === 'email' || name.includes('email')) return 'testuser@test.com'
  if (type === 'password' || name.includes('password')) return 'TestPass123!'
  if (type === 'tel' || name.includes('phone')) return '07700900000'
  if (type === 'number') return '42'
  if (type === 'date') return '2024-06-01'
  if (name.includes('postcode') || name.includes('zip')) return 'SW1A 1AA'
  if (name.includes('name')) return 'John Smith'
  return null
}

function noFill(): FillResult {
  return { value: null, key: null, source: 'skip', confidence: null }
}
