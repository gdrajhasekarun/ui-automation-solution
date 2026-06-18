import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'
import * as crypto from 'crypto'

const rootEnv = path.resolve(import.meta.dirname, '../../../.env')
dotenv.config({ path: rootEnv })
dotenv.config()

import express, { type Request, type Response } from 'express'
import { RequestPayloadSchema, CrawlerConfigSchema, type JobRecord } from './types.js'
import { resolveOutputDir } from './data/index.js'
import { runCrawl } from './orchestration/index.js'
import { log } from './logger.js'

const PORT          = parseInt(process.env.FLOW_CRAWLER_PORT || '8006', 10)
const GENERATOR_URL = process.env.GENERATOR_URL || 'http://localhost:8002'
const _jobs = new Map<string, JobRecord>()

async function notifyGenerator(appId: string, jobId: string, frameworkDir: string, targetTool: string): Promise<void> {
  try {
    const VALID_TOOLS = ['selenium-java','selenium-csharp','selenium-python','playwright-js','playwright-ts','playwright-python','cypress-js','cypress-ts']
    const resolvedTool = VALID_TOOLS.includes(targetTool) ? targetTool : 'selenium-java'
    const endpoint = `${GENERATOR_URL}/v2/trigger`
    await fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ app_id: appId, build_id: jobId, framework_dir: frameworkDir, target_tool: resolvedTool }),
      signal:  AbortSignal.timeout(10000),
    })
    log.info('GENERATOR', `Notified generator for app_id=${appId}  target_tool=${targetTool || 'default'}`)
  } catch (err: any) {
    log.warn('GENERATOR', `Generator notification failed: ${err.message}`)
  }
}

async function runJob(jobId: string, payload: ReturnType<typeof RequestPayloadSchema.parse>): Promise<void> {
  const job = _jobs.get(jobId)!
  job.status = 'RUNNING'

  try {
    const outputDir = resolveOutputDir(payload.output_dir)
    // Load static config from crawler.config.json for LLM provider/model settings
    let fileConfig: Record<string, any> = {}
    try {
      const cfgPath = path.resolve(import.meta.dirname, '../crawler.config.json')
      fileConfig = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
    } catch { /* use defaults */ }

    const config = CrawlerConfigSchema.parse({
      appId:    payload.app_id,
      seedUrl:  payload.app_url,
      outputDir,
      headless: payload.headless,
      maxDepth: payload.max_depth,
      maxPages: payload.max_pages,
      llm: {
        ...(fileConfig.llm ?? {}),
        enabled: payload.llm_enabled,
      },
    })

    const flowName = payload.target_flows?.[0]
    if (flowName) (config as any).flowName = flowName

    const result = await runCrawl(config, payload)

    job.status          = 'COMPLETE'
    job.finished_at     = new Date().toISOString()
    job.node_count      = result.nodeCount
    job.edge_count      = result.edgeCount
    job.unfilled_fields = result.unfilledFields
    job.llm_call_count  = result.llmCallCount
    job.cache_hit_count = result.cacheHitCount
    job.output_file     = result.outputFile
    job.summary         = result.summary
    log.success('JOB', `${jobId} complete — nodes: ${result.nodeCount}  edges: ${result.edgeCount}`)

    await notifyGenerator(payload.app_id, jobId, payload.framework_dir ?? '', payload.target_tool ?? '')
  } catch (err: any) {
    job.status      = 'FAILED'
    job.finished_at = new Date().toISOString()
    job.error       = err.message
    log.error('JOB', `${jobId} failed: ${err.message}`)
  }
}

const app = express()
app.use(express.json())

app.post('/trigger', (req: Request, res: Response) => {
  const parsed = RequestPayloadSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', detail: parsed.error.flatten() })
    return
  }

  const payload = parsed.data
  const jobId   = crypto.randomUUID()
  const job: JobRecord = {
    status:     'STARTED',
    app_id:     payload.app_id,
    seed_url:   payload.app_url,
    started_at: new Date().toISOString(),
  }
  _jobs.set(jobId, job)
  log.info('TRIGGER', `Job ${jobId} started — ${payload.app_url}`)

  runJob(jobId, payload).catch(() => {})

  res.json({ job_id: jobId, status: 'STARTED', app_id: payload.app_id })
})

app.get('/status/:jobId', (req: Request, res: Response) => {
  const job = _jobs.get(String(req.params.jobId))
  if (!job) { res.status(404).json({ error: 'not found' }); return }
  res.json(job)
})

app.get('/graph/:appId', (req: Request, res: Response) => {
  const appId     = String(req.params.appId)
  const outputDir = resolveOutputDir(undefined)
  const candidates = [
    path.join(outputDir, appId, 'graph.json'),
    path.join(outputDir, 'graph.json'),
  ]
  const found = candidates.find(p => fs.existsSync(p))
  if (!found) {
    res.status(404).json({ detail: 'Graph not found — run a crawl first' })
    return
  }
  res.json(JSON.parse(fs.readFileSync(found, 'utf8')))
})

app.get('/jobs', (_req: Request, res: Response) => {
  const jobs = Array.from(_jobs.entries())
    .reverse()
    .map(([id, j]) => ({ job_id: id, ...j }))
  res.json({ jobs })
})

app.get('/health', (_req: Request, res: Response) => {
  const running = Array.from(_jobs.values()).filter(j => j.status === 'RUNNING').length
  res.json({ service: 'flow-crawler', status: running > 0 ? 'running' : 'idle', port: PORT, active_jobs: running })
})

process.on('unhandledRejection', (reason) => log.error('PROCESS', `Unhandled rejection: ${reason}`))
process.on('uncaughtException',  (err)    => log.error('PROCESS', `Uncaught exception: ${err.message}`))

const server = app.listen(PORT, () => {
  log.phase('Flow Crawler — TypeScript · Playwright · LangChain')
  log.success('SERVER', `Listening on port ${PORT}  |  Log: ${log.filePath}`)
})

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    log.error('SERVER', `Port ${PORT} already in use`)
  } else {
    log.error('SERVER', `Server error: ${err.message}`)
  }
  process.exit(1)
})
