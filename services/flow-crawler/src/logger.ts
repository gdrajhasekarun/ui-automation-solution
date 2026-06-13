import * as fs from 'fs'
import * as path from 'path'

const LOG_DIR  = path.resolve(process.cwd(), 'logs')
const LOG_FILE = path.join(LOG_DIR, `flow-crawler-${new Date().toISOString().slice(0, 10)}.log`)

fs.mkdirSync(LOG_DIR, { recursive: true })
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' })

const C = {
  reset:   '\x1b[0m',
  grey:    '\x1b[90m',
  cyan:    '\x1b[36m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  red:     '\x1b[31m',
  magenta: '\x1b[35m',
  blue:    '\x1b[34m',
  bold:    '\x1b[1m',
}

type Level = 'DEBUG' | 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR' | 'STEP'

const LEVEL_COLOUR: Record<Level, string> = {
  DEBUG:   C.grey,
  INFO:    C.cyan,
  SUCCESS: C.green,
  WARNING: C.yellow,
  ERROR:   C.red,
  STEP:    C.magenta,
}

const LEVEL_ICON: Record<Level, string> = {
  DEBUG:   '·',
  INFO:    '→',
  SUCCESS: '✓',
  WARNING: '⚠',
  ERROR:   '✗',
  STEP:    '▶',
}

function write(level: Level, stage: string, message: string, meta?: Record<string, unknown>): void {
  const ts      = new Date().toISOString()
  const colour  = LEVEL_COLOUR[level]
  const icon    = LEVEL_ICON[level]
  const metaStr = meta ? ' ' + JSON.stringify(meta) : ''

  const stageTag = `[${stage.padEnd(12)}]`
  console.log(
    `${C.grey}${ts.slice(11, 23)}${C.reset} ` +
    `${colour}${icon} ${level.padEnd(7)}${C.reset} ` +
    `${C.bold}${stageTag}${C.reset} ` +
    `${message}` +
    `${C.grey}${metaStr}${C.reset}`
  )

  const line = JSON.stringify({ ts, level, stage, message, ...(meta || {}) })
  logStream.write(line + '\n')
}

export const log = {
  debug:   (stage: string, msg: string, meta?: Record<string, unknown>) => write('DEBUG',   stage, msg, meta),
  info:    (stage: string, msg: string, meta?: Record<string, unknown>) => write('INFO',    stage, msg, meta),
  success: (stage: string, msg: string, meta?: Record<string, unknown>) => write('SUCCESS', stage, msg, meta),
  warn:    (stage: string, msg: string, meta?: Record<string, unknown>) => write('WARNING', stage, msg, meta),
  error:   (stage: string, msg: string, meta?: Record<string, unknown>) => write('ERROR',   stage, msg, meta),
  step:    (stage: string, msg: string, meta?: Record<string, unknown>) => write('STEP',    stage, msg, meta),

  phase: (label: string) => {
    const line = '─'.repeat(60)
    const ts   = new Date().toISOString()
    console.log(`\n${C.blue}${line}${C.reset}`)
    console.log(`${C.blue}${C.bold}  ${label}${C.reset}`)
    console.log(`${C.blue}${line}${C.reset}\n`)
    logStream.write(JSON.stringify({ ts, level: 'PHASE', stage: 'SYSTEM', message: label }) + '\n')
  },

  filePath: LOG_FILE,
}
