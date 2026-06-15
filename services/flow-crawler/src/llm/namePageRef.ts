import { z } from 'zod'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { CapturedElement, Node } from '../types.js'

const Schema = z.object({
  pageRef:     z.string(),
  description: z.string(),
})

// Returns the pageRef from an existing node if ≥80% of element labels overlap
export function findExistingPageRef(
  elements: CapturedElement[],
  existingNodes: Record<string, Node>,
): string | null {
  if (!elements.length || !Object.keys(existingNodes).length) return null

  const currentLabels = new Set(elements.map(e => e.name.trim().toLowerCase()).filter(Boolean))
  if (!currentLabels.size) return null

  let bestRef: string | null = null
  let bestScore = 0

  for (const node of Object.values(existingNodes)) {
    if (!node.pageRef || !node.elements?.length) continue

    const nodeLabels = new Set(node.elements.map(e => e.name.trim().toLowerCase()).filter(Boolean))
    if (!nodeLabels.size) continue

    // Jaccard similarity: intersection / union
    let intersection = 0
    for (const label of currentLabels) {
      if (nodeLabels.has(label)) intersection++
    }
    const union = currentLabels.size + nodeLabels.size - intersection
    const score = intersection / union

    if (score > bestScore) {
      bestScore = score
      bestRef = node.pageRef
    }
  }

  return bestScore >= 0.8 ? bestRef : null
}

export interface PageMeta {
  pageRef:     string
  description: string
}

export async function namePageRef(
  title:         string,
  url:           string,
  elements:      CapturedElement[],
  llm:           BaseChatModel,
  existingNodes: Record<string, Node> = {},
  usedNames:     Set<string> = new Set(),
): Promise<PageMeta> {
  // Reuse existing name if page is sufficiently similar (description not re-generated)
  const existing = findExistingPageRef(elements, existingNodes)
  if (existing) {
    const existingNode = Object.values(existingNodes).find(n => n.pageRef === existing)
    return { pageRef: existing, description: existingNode?.description ?? '' }
  }

  const fields = elements
    .filter(e => e.elementType === 'textbox' || e.elementType === 'textarea' ||
                 e.elementType === 'select'  || e.elementType === 'combobox')
    .map(e => `  ${e.elementType.padEnd(8)} "${e.name}"`)

  const actions = elements
    .filter(e => e.elementType === 'button' || e.elementType === 'link')
    .map(e => `  ${e.elementType.padEnd(8)} "${e.name}"`)

  const elSection = [
    fields.length  ? `Form fields:\n${fields.join('\n')}`   : '',
    actions.length ? `Actions:\n${actions.slice(0, 10).join('\n')}` : '',
  ].filter(Boolean).join('\n\n')

  const avoidSection = usedNames.size > 0
    ? `\nAlready used names (do NOT use these or close variations):\n${[...usedNames].map(n => `  - ${n}`).join('\n')}\n`
    : ''

  const prompt =
    `You are analysing a web page state for a UI automation graph.

Page title: ${title}
Page URL: ${url}

${elSection}
${avoidSection}
Return two things:

1. pageRef — a concise reference name (3-7 words) that:
   - Prioritises FORM FIELDS to describe what the user fills in (e.g. "City and Zip Code Entry", "Network Plan Selection")
   - Falls back to the primary ACTION if there are no fields (e.g. "Browse by Category", "Search Results View")
   - Is DISTINCT from all already-used names above
   - Does NOT include dates, years, version numbers, or dynamic values

2. description — 1-2 sentences describing:
   - What this page/step is for in the user journey
   - Who the target user is (e.g. member, non-member, provider) if determinable from context
   - What the user must do here to proceed (e.g. "User selects their network plan and clicks Continue to advance enrollment")
   - Keep it factual and useful for an LLM planning E2E test steps`

  try {
    const result = await llm.withStructuredOutput(Schema).invoke(prompt)
    return { pageRef: result.pageRef.trim(), description: result.description.trim() }
  } catch {
    return { pageRef: title, description: '' }
  }
}
