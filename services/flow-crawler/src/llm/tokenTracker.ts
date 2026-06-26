import { BaseCallbackHandler } from '@langchain/core/callbacks/base'
import type { LLMResult } from '@langchain/core/outputs'

export interface LLMCallRecord {
  fn:           string   // label passed at bind time e.g. "pickNextAction"
  model:        string
  inputTokens:  number
  outputTokens: number
  costUsd:      number
  ts:           number   // unix ms
}

// Price per 1M tokens [input, output] in USD
const MODEL_PRICING: Record<string, [number, number]> = {
  'gpt-4o':            [2.50,  10.00],
  'gpt-4o-mini':       [0.15,   0.60],
  'gpt-4-turbo':       [10.00, 30.00],
  'gpt-4':             [30.00, 60.00],
  'gpt-3.5-turbo':     [0.50,   1.50],
  'claude-opus-4':     [15.00, 75.00],
  'claude-sonnet-4-5': [3.00,  15.00],
  'claude-haiku-4-5':  [0.80,   4.00],
  'claude-3-5-sonnet': [3.00,  15.00],
  'claude-3-5-haiku':  [0.80,   4.00],
  'claude-3-opus':     [15.00, 75.00],
  'gemini-1.5-pro':    [3.50,  10.50],
  'gemini-1.5-flash':  [0.075,  0.30],
}

function calcCost(model: string, inputTokens: number, outputTokens: number): number {
  const key = Object.keys(MODEL_PRICING).find(k => model.toLowerCase().includes(k))
  if (!key) return 0
  const [inPrice, outPrice] = MODEL_PRICING[key]
  return (inputTokens / 1_000_000) * inPrice + (outputTokens / 1_000_000) * outPrice
}

export class TokenTracker {
  calls: LLMCallRecord[] = []

  /** Create a LangChain callback handler that records token usage under `fn` label. */
  callbackFor(fn: string): BaseCallbackHandler {
    const tracker = this
    return new (class extends BaseCallbackHandler {
      name = 'TokenTrackerCallback'
      async handleLLMEnd(output: LLMResult) {
        // Try all known locations for token usage across OpenAI, Anthropic, Gemini
        const llmOut  = (output as any).llmOutput ?? {}
        const gen0    = (output.generations?.[0]?.[0] as any) ?? {}
        const msgMeta = gen0.message?.usage_metadata ?? gen0.generationInfo?.usage_metadata ?? {}
        const tu      = llmOut.tokenUsage ?? llmOut.usage ?? {}

        // OpenAI: tokenUsage.{promptTokens, completionTokens}
        // Anthropic: llmOutput.usage.{input_tokens, output_tokens} or usage_metadata
        const inputTokens  = tu.promptTokens     ?? tu.input_tokens  ?? msgMeta.input_tokens  ?? 0
        const outputTokens = tu.completionTokens ?? tu.output_tokens ?? msgMeta.output_tokens ?? 0
        if (inputTokens === 0 && outputTokens === 0) return
        const model = llmOut.model_name
          ?? gen0.message?.response_metadata?.model_name
          ?? gen0.message?.response_metadata?.model
          ?? 'unknown'
        tracker.calls.push({
          fn, model, inputTokens, outputTokens,
          costUsd: calcCost(model, inputTokens, outputTokens),
          ts: Date.now(),
        })
      }
    })()
  }

  /**
   * Attach this tracker to an LLM instance by setting its `callbacks` property.
   * LangChain reads `this.callbacks` at invoke time via CallbackManager.configure,
   * so mutation after construction is picked up on every subsequent call.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  attachTo(llm: any, fn: string): void {
    const cb = this.callbackFor(fn)
    if (!llm.callbacks) {
      llm.callbacks = [cb]
    } else if (Array.isArray(llm.callbacks)) {
      llm.callbacks.push(cb)
    } else {
      // CallbackManager instance — use addHandler
      llm.callbacks.addHandler?.(cb)
    }
  }

  get totalCostUsd(): number { return this.calls.reduce((s, c) => s + c.costUsd, 0) }
  get totalTokens():  number { return this.calls.reduce((s, c) => s + c.inputTokens + c.outputTokens, 0) }

  summary() {
    return {
      totalCalls:   this.calls.length,
      totalTokens:  this.totalTokens,
      totalCostUsd: +this.totalCostUsd.toFixed(6),
      calls:        this.calls,
    }
  }
}
