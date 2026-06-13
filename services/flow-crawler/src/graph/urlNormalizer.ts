import { createHash } from 'crypto'

export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw)
    u.hash = ''
    // Sort query params for stable comparison
    const params = Array.from(u.searchParams.entries()).sort(([a], [b]) => a.localeCompare(b))
    u.search = ''
    params.forEach(([k, v]) => u.searchParams.append(k, v))
    return u.toString().replace(/\/$/, '')
  } catch {
    return raw
  }
}

export function nodeId(normalizedUrl: string): string {
  return createHash('sha1').update(normalizedUrl).digest('hex').slice(0, 12)
}

export function edgeId(): string {
  return createHash('sha1').update(`${Date.now()}-${Math.random()}`).digest('hex').slice(0, 12)
}

export function pageFingerprint(elementIds: string[]): string {
  return createHash('sha1').update(elementIds.sort().join('|')).digest('hex').slice(0, 12)
}
