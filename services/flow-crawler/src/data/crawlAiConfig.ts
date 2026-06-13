import * as path from 'path'
import * as fs from 'fs'

// Reads the crawl-ai outputDir the same way crawl-ai resolves it at runtime.
// crawl-ai server.ts line 105: output_dir || '../../shared/outputs'
// This function provides the same default, honouring any env override.
export function resolveOutputDir(requestOutputDir?: string): string {
  // 1. Request payload wins
  if (requestOutputDir) return path.resolve(requestOutputDir)

  // 2. Read crawl-ai's crawler config if it exists alongside this service
  const crawlAiConfig = path.resolve(import.meta.dirname, '../../../crawl-ai/crawler.config.json')
  if (fs.existsSync(crawlAiConfig)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(crawlAiConfig, 'utf8'))
      if (cfg.outputDir) return path.resolve(path.dirname(crawlAiConfig), cfg.outputDir)
    } catch { /* ignore */ }
  }

  // 3. This service's own crawler.config.json
  const localConfig = path.resolve(import.meta.dirname, '../../crawler.config.json')
  if (fs.existsSync(localConfig)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(localConfig, 'utf8'))
      if (cfg.outputDir) return path.resolve(path.dirname(localConfig), cfg.outputDir)
    } catch { /* ignore */ }
  }

  // 4. Same default as crawl-ai: ../../shared/outputs (relative to this service root)
  return path.resolve(import.meta.dirname, '../../..', 'shared/outputs')
}
