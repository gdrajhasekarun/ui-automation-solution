import * as fs from 'fs'
import type { CrawlData, CachedInteraction, ElementType } from '../types.js'
import { log } from '../logger.js'

export class CrawlDataCache {
  private data: CrawlData
  private dirty = false

  constructor(private readonly filePath: string) {
    if (fs.existsSync(filePath)) {
      try {
        this.data = JSON.parse(fs.readFileSync(filePath, 'utf8')) as CrawlData
      } catch {
        this.data = { version: '1', interactions: {} }
      }
    } else {
      this.data = { version: '1', interactions: {} }
    }
  }

  async get(key: string): Promise<CachedInteraction | null> {
    const hit = this.data.interactions[key]
    if (!hit) return null
    hit.usageCount = (hit.usageCount ?? 0) + 1
    hit.lastUsed   = new Date().toISOString()
    this.dirty = true
    log.info('CACHE', `HIT  "${key}" → "${hit.value}" (used ${hit.usageCount} times)`)
    return hit
  }

  async set(key: string, interaction: CachedInteraction): Promise<void> {
    this.data.interactions[key] = interaction
    this.dirty = true
    await this.flush()
  }

  async flush(): Promise<void> {
    if (!this.dirty) return
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8')
    this.dirty = false
  }

  // Build a globally-stable cache key (not URL-scoped when possible)
  static buildKey(
    opts: { excelKey?: string; llmKey?: string; normalizedUrl: string; elementName: string; elementType: ElementType }
  ): string {
    if (opts.excelKey) return opts.excelKey
    if (opts.llmKey)   return opts.llmKey
    return `${new URL(opts.normalizedUrl).pathname}_${opts.elementName}_${opts.elementType}`
      .toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_')
  }
}
