import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { CrawlerConfig, LLMProvider } from '../types.js'
import { log } from '../logger.js'

export interface LLMPair {
  smartLLM: BaseChatModel
  fastLLM:  BaseChatModel
}

export async function buildLLMPair(config: CrawlerConfig): Promise<LLMPair | null> {
  if (!config.llm.enabled) return null

  const smartProvider = config.llm.smartProvider
  const fastProvider  = config.llm.fastProvider

  const smartLLM = await createModel(smartProvider, config.llm.smartModel, config)
  const fastLLM  = await createModel(fastProvider,  config.llm.fastModel,  config)

  if (!smartLLM || !fastLLM) return null
  return { smartLLM, fastLLM }
}

async function createModel(
  provider: LLMProvider,
  model: string,
  config: CrawlerConfig
): Promise<BaseChatModel | null> {
  try {
    switch (provider) {
      case 'anthropic': {
        const { ChatAnthropic } = await import('@langchain/anthropic')
        return new ChatAnthropic({ model, temperature: 0 }) as unknown as BaseChatModel
      }
      case 'openai': {
        const { ChatOpenAI } = await import('@langchain/openai')
        return new ChatOpenAI({ model, temperature: 0 }) as unknown as BaseChatModel
      }
      case 'gemini': {
        const { ChatGoogleGenerativeAI } = await import('@langchain/google-genai')
        return new ChatGoogleGenerativeAI({ model, temperature: 0 }) as unknown as BaseChatModel
      }
      case 'ollama': {
        const { ChatOllama } = await import('@langchain/ollama')
        return new ChatOllama({ model, baseUrl: config.llm.ollamaBaseUrl }) as unknown as BaseChatModel
      }
      case 'azure': {
        const { AzureChatOpenAI } = await import('@langchain/openai')
        return new AzureChatOpenAI({
          model,
          azureOpenAIEndpoint:   config.llm.azureEndpoint,
          azureOpenAIApiDeploymentName: config.llm.azureDeployment,
          temperature: 0,
        }) as unknown as BaseChatModel
      }
      default:
        return null
    }
  } catch (err: any) {
    log.warn('LLM', `Failed to load provider "${provider}": ${err.message}`)
    return null
  }
}

export { parseNotes }      from './parseNotes.js'
export { filterElements }  from './filterElements.js'
export { pickNextAction }  from './pickNextAction.js'
export { reasonFields }    from './reasonFields.js'
export { summarizeGraph }  from './summarize.js'
export { namePageRef }     from './namePageRef.js'
