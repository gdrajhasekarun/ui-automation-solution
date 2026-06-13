import { z } from 'zod'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { CapturedElement, Node } from '../types.js'

const Schema = z.object({ pageRef: z.string() })

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

export async function namePageRef(
  title:         string,
  url:           string,
  elements:      CapturedElement[],
  llm:           BaseChatModel,
  existingNodes: Record<string, Node> = {},
  usedNames:     Set<string> = new Set(),
): Promise<string> {
  // Reuse existing name if page is sufficiently similar
  const existing = findExistingPageRef(elements, existingNodes)
  if (existing) return existing

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
    `You are naming a web page state for a UI automation graph.

Page title: ${title}
Page URL: ${url}

${elSection}
${avoidSection}
Give this page state a concise, descriptive reference name (3-7 words) that:
- Prioritises the FORM FIELDS to describe what the user fills in (e.g. "City and Zip Code Entry", "Network Plan Selection")
- Falls back to the primary ACTION if there are no fields (e.g. "Browse by Category", "Search Results View")
- Is DISTINCT from all already-used names above

Rules:
- Do NOT include any dates, years, or timestamps
- Do NOT include version numbers or dynamic values
- Return ONLY the pageRef string — no quotes, no explanation`

  try {
    const result = await llm.withStructuredOutput(Schema).invoke(prompt)
    return result.pageRef.trim()
  } catch {
    return title
  }
}
