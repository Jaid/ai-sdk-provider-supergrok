import type {SupergrokProviderOptions} from './providerOptions.ts'
import type {SupergrokTokenManager} from './tokenManager.ts'
import type {LanguageModelV3, LanguageModelV3CallOptions, LanguageModelV3Content, LanguageModelV3FinishReason, LanguageModelV3GenerateResult, LanguageModelV3StreamPart, LanguageModelV3StreamResult, LanguageModelV3Usage, SharedV3Warning} from '@ai-sdk/provider'
import type {FetchFunction, ParseResult} from '@ai-sdk/provider-utils'

import {APICallError} from '@ai-sdk/provider'
import {combineHeaders,
  createEventSourceResponseHandler,
  createJsonResponseHandler,
  extractResponseHeaders,

  parseProviderOptions,

  postJsonToApi} from '@ai-sdk/provider-utils'
import {z} from 'zod/v4'

import {convertToXaiMessages} from './supergrok-convert-messages'
import {supergrokFailedResponseHandler} from './supergrok-error'
import {mapSupergrokFinishReason} from './mapFinishReason.ts'
import {prepareTools} from './prepareTools.ts'
import {supergrokProviderOptionsSchema} from './providerOptions.ts'
import {VERSION} from './version.ts'

// ─── public types ───────────────────────────────────────────────────────────

export type SupergrokModelId = string & {}

export interface SupergrokLanguageModelConfig {
  baseURL: string
  clientName?: string
  fetch?: FetchFunction
  provider: string
  tokenManager: SupergrokTokenManager
}

// ─── response schemas ───────────────────────────────────────────────────────

const xaiUsageSchema = z.object({
  prompt_tokens: z.number(),
  completion_tokens: z.number(),
  total_tokens: z.number(),
  prompt_tokens_details: z
    .object({
      cached_tokens: z.number().nullish(),
      text_tokens: z.number().nullish(),
      image_tokens: z.number().nullish(),
    })
    .nullish(),
  completion_tokens_details: z
    .object({
      reasoning_tokens: z.number().nullish(),
    })
    .nullish(),
})
const xaiChatResponseSchema = z.object({
  id: z.string().nullish(),
  created: z.number().nullish(),
  model: z.string().nullish(),
  object: z.literal('chat.completion').nullish(),
  choices: z
    .array(z.object({
      index: z.number(),
      message: z.object({
        role: z.literal('assistant'),
        content: z.string().nullish(),
        reasoning_content: z.string().nullish(),
        tool_calls: z
          .array(z.object({
            id: z.string(),
            type: z.literal('function'),
            function: z.object({
              name: z.string(),
              arguments: z.string(),
            }),
          }))
          .nullish(),
      }),
      finish_reason: z.string().nullish(),
    }))
    .nullish(),
  usage: xaiUsageSchema.nullish(),
})
const xaiChatChunkSchema = z.object({
  id: z.string().nullish(),
  created: z.number().nullish(),
  model: z.string().nullish(),
  choices: z.array(z.object({
    index: z.number(),
    delta: z.object({
      role: z.enum(['assistant']).optional(),
      content: z.string().nullish(),
      reasoning_content: z.string().nullish(),
      tool_calls: z
        .array(z.object({
          id: z.string(),
          type: z.literal('function'),
          function: z.object({
            name: z.string(),
            arguments: z.string(),
          }),
        }))
        .nullish(),
    }),
    finish_reason: z.string().nullish(),
  })),
  usage: xaiUsageSchema.nullish(),
})

// ─── helpers ────────────────────────────────────────────────────────────────

function convertUsage(usage: z.infer<typeof xaiUsageSchema> | null | undefined): LanguageModelV3Usage {
  if (!usage) {
    return {
      inputTokens: {
        total: 0,
        noCache: 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
      outputTokens: {
        total: 0,
        text: 0,
        reasoning: 0,
      },
    }
  }
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0
  return {
    inputTokens: {
      total: usage.prompt_tokens,
      noCache: usage.prompt_tokens - cached,
      cacheRead: cached,
      cacheWrite: 0,
    },
    outputTokens: {
      total: usage.completion_tokens,
      text:
        usage.completion_tokens
        - (usage.completion_tokens_details?.reasoning_tokens ?? 0),
      reasoning: usage.completion_tokens_details?.reasoning_tokens ?? 0,
    },
  }
}

// ─── language model class ───────────────────────────────────────────────────

export class SupergrokLanguageModel implements LanguageModelV3 {
  readonly modelId: SupergrokModelId
  readonly specificationVersion = 'v3' as const

  readonly supportedUrls: Record<string, Array<RegExp>> = {
    'image/*': [/^https?:\/\/.*$/],
  }

  private readonly config: SupergrokLanguageModelConfig

  constructor(modelId: SupergrokModelId,
    config: SupergrokLanguageModelConfig) {
    this.modelId = modelId
    this.config = config
  }

  get provider(): string {
    return this.config.provider
  }

  // ── request helpers ────────────────────────────────────────────────────

  async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
    const {args, warnings} = await this.buildArgs(options)
    const headers = await this.getHeaders(options.headers)
    const result = await postJsonToApi({
      url: `${this.config.baseURL}/chat/completions`,
      headers,
      body: args,
      failedResponseHandler: supergrokFailedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler(xaiChatResponseSchema),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    })
    const {value: response, rawValue: rawResponse, responseHeaders} = result
    const choice = response.choices![0]
    const content: Array<LanguageModelV3Content> = []
    if (choice.message.content && choice.message.content.length > 0) {
      content.push({
        type: 'text',
        text: choice.message.content,
      })
    }
    if (
      choice.message.reasoning_content
      && choice.message.reasoning_content.length > 0
    ) {
      content.push({
        type: 'reasoning',
        text: choice.message.reasoning_content,
      })
    }
    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        content.push({
          type: 'tool-call',
          toolCallId: tc.id,
          toolName: tc.function.name,
          input: tc.function.arguments,
        })
      }
    }
    return {
      content,
      finishReason: mapSupergrokFinishReason(choice.finish_reason),
      usage: convertUsage(response.usage),
      request: {body: args},
      response: {
        id: response.id ?? undefined,
        timestamp: response.created ? new Date(response.created * 1000) : new Date,
        modelId: response.model ?? this.modelId,
        headers: responseHeaders,
        body: rawResponse,
      },
      warnings,
    }
  }

  // ── argument builder ───────────────────────────────────────────────────

  async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
    const {args, warnings} = await this.buildArgs(options)
    const headers = await this.getHeaders(options.headers)
    const streamArgs = {
      ...args,
      stream: true,
      stream_options: {include_usage: true},
    }
    const result = (await postJsonToApi({
      url: `${this.config.baseURL}/chat/completions`,
      headers,
      body: streamArgs,
      failedResponseHandler: supergrokFailedResponseHandler,
      successfulResponseHandler:
        createEventSourceResponseHandler(xaiChatChunkSchema),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    })) as {
      responseHeaders?: Record<string, string>
      value: ReadableStream<ParseResult<z.infer<typeof xaiChatChunkSchema>>>
    }
    const {value: stream, responseHeaders} = result
    let finishReason: LanguageModelV3FinishReason = {
      unified: 'other',
      raw: undefined,
    }
    let usage: LanguageModelV3Usage = convertUsage(null)
    let isFirstChunk = true
    let activeReasoningBlockId: string | undefined
    return {
      stream: stream.pipeThrough(new TransformStream<
        ParseResult<z.infer<typeof xaiChatChunkSchema>>,
        LanguageModelV3StreamPart
      >({
        start(controller) {
          controller.enqueue({
            type: 'stream-start',
            warnings,
          })
        },

        transform(chunk, controller) {
          if (options.includeRawChunks) {
            controller.enqueue({
              type: 'raw',
              rawValue: chunk.rawValue,
            })
          }
          if (!chunk.success) {
            controller.enqueue({
              type: 'error',
              error: chunk.error,
            })
            return
          }
          const value = chunk.value
          if (isFirstChunk) {
            controller.enqueue({
              type: 'response-metadata',
              id: value.id ?? undefined,
              timestamp: value.created ? new Date(value.created * 1000) : undefined,
              modelId: value.model ?? undefined,
            })
            isFirstChunk = false
          }
          if (value.usage != null) {
            usage = convertUsage(value.usage)
          }
          const choice = value.choices[0]
          if (choice?.finish_reason != null) {
            finishReason = mapSupergrokFinishReason(choice.finish_reason)
          }
          if (!choice?.delta) {
            return
          }
          const {delta} = choice
          const choiceIndex = choice.index
          if (delta.content) {
            if (activeReasoningBlockId != null) {
              controller.enqueue({
                id: activeReasoningBlockId,
                type: 'reasoning-end',
              })
              activeReasoningBlockId = undefined
            }
            const blockId = `text-${choiceIndex}`
            controller.enqueue({
              id: blockId,
              type: 'text-start',
            })
            controller.enqueue({
              type: 'text-delta',
              id: blockId,
              delta: delta.content,
            })
            controller.enqueue({
              id: blockId,
              type: 'text-end',
            })
          }
          if (delta.reasoning_content) {
            const blockId = `reasoning-${choiceIndex}`
            if (activeReasoningBlockId == null) {
              activeReasoningBlockId = blockId
              controller.enqueue({
                id: blockId,
                type: 'reasoning-start',
              })
            }
            controller.enqueue({
              type: 'reasoning-delta',
              id: blockId,
              delta: delta.reasoning_content,
            })
          }
          if (delta.tool_calls) {
            if (activeReasoningBlockId != null) {
              controller.enqueue({
                id: activeReasoningBlockId,
                type: 'reasoning-end',
              })
              activeReasoningBlockId = undefined
            }
            for (const tc of delta.tool_calls) {
              controller.enqueue({
                type: 'tool-input-start',
                id: tc.id,
                toolName: tc.function.name,
              })
              controller.enqueue({
                type: 'tool-input-delta',
                id: tc.id,
                delta: tc.function.arguments,
              })
              controller.enqueue({
                id: tc.id,
                type: 'tool-input-end',
              })
              controller.enqueue({
                type: 'tool-call',
                toolCallId: tc.id,
                toolName: tc.function.name,
                input: tc.function.arguments,
              })
            }
          }
        },

        flush(controller) {
          if (activeReasoningBlockId != null) {
            controller.enqueue({
              id: activeReasoningBlockId,
              type: 'reasoning-end',
            })
          }
          controller.enqueue({
            type: 'finish',
            finishReason,
            usage,
          })
        },
      })),
      request: {body: streamArgs},
      response: {headers: responseHeaders},
    }
  }

  // ── doGenerate ────────────────────────────────────────────────────────

  private async buildArgs(options: LanguageModelV3CallOptions) {
    const {prompt,
      maxOutputTokens,
      temperature,
      topP,
      topK,
      frequencyPenalty,
      presencePenalty,
      stopSequences,
      seed,
      responseFormat,
      tools,
      toolChoice,
      providerOptions} = options
    const warnings: Array<SharedV3Warning> = []
    const supergrokOptions = (await parseProviderOptions({
      provider: 'supergrok',
      providerOptions,
      schema: supergrokProviderOptionsSchema,
    })) as SupergrokProviderOptions | null
    if (topK != null) {
      warnings.push({
        type: 'unsupported',
        feature: 'topK',
      })
    }
    if (frequencyPenalty != null) {
      warnings.push({
        type: 'unsupported',
        feature: 'frequencyPenalty',
      })
    }
    if (presencePenalty != null) {
      warnings.push({
        type: 'unsupported',
        feature: 'presencePenalty',
      })
    }
    if (stopSequences != null) {
      warnings.push({
        type: 'unsupported',
        feature: 'stopSequences',
      })
    }
    const {messages, warnings: messageWarnings} = convertToXaiMessages(prompt)
    warnings.push(...messageWarnings)
    const {tools: xaiTools,
      toolChoice: xaiToolChoice,
      toolWarnings} = prepareTools({
      tools,
      toolChoice,
    })
    warnings.push(...toolWarnings)
    const args: Record<string, unknown> = {
      model: this.modelId,
      max_completion_tokens: maxOutputTokens,
      temperature,
      top_p: topP,
      seed,
      messages,
      tools: xaiTools,
      tool_choice: xaiToolChoice,
    }
    if (responseFormat?.type === 'json') {
      if (responseFormat.schema != null) {
        args.response_format = {
          type: 'json_schema',
          json_schema: {
            name: responseFormat.name ?? 'response',
            schema: responseFormat.schema,
            strict: true,
          },
        }
      } else {
        args.response_format = {type: 'json_object'}
      }
    }
    if (supergrokOptions?.reasoningEffort != null) {
      args.reasoning_effort = supergrokOptions.reasoningEffort
    }
    if (supergrokOptions?.logprobs != null) {
      args.logprobs = supergrokOptions.logprobs
    }
    if (supergrokOptions?.topLogprobs != null) {
      args.top_logprobs = supergrokOptions.topLogprobs
    }
    if (supergrokOptions?.parallelFunctionCalling != null) {
      args.parallel_function_calling = supergrokOptions.parallelFunctionCalling
    }
    if (supergrokOptions?.searchParameters != null) {
      const sp = supergrokOptions.searchParameters
      const sources = sp.sources?.map(source => {
        const base = {type: source.type}
        switch (source.type) {
          case 'web': {
            return {
              ...base,
              country: source.country,
              excluded_websites: source.excludedWebsites,
              allowed_websites: source.allowedWebsites,
              safe_search: source.safeSearch,
            }
          }
          case 'x': {
            return {
              ...base,
              excluded_x_handles: source.excludedXHandles,
              included_x_handles: source.includedXHandles ?? source.xHandles,
              post_favorite_count: source.postFavoriteCount,
              post_view_count: source.postViewCount,
            }
          }
          case 'news': {
            return {
              ...base,
              country: source.country,
              excluded_websites: source.excludedWebsites,
              safe_search: source.safeSearch,
            }
          }
          case 'rss': {
            return {
              ...base,
              links: source.links,
            }
          }
        }
      })
      args.search_parameters = {
        mode: sp.mode,
        ...sp.returnCitations != null && {return_citations: sp.returnCitations},
        ...sp.fromDate != null && {from_date: sp.fromDate},
        ...sp.toDate != null && {to_date: sp.toDate},
        ...sp.maxSearchResults != null && {max_search_results: sp.maxSearchResults},
        ...sources?.length ? {sources} : {},
      }
    }
    return {
      args,
      warnings,
    }
  }

  // ── doStream ──────────────────────────────────────────────────────────

  private async getHeaders(callHeaders?: Record<string, string | undefined>): Promise<Record<string, string | undefined>> {
    const accessToken = await this.config.tokenManager.getAccessToken()
    return combineHeaders(callHeaders, {
      authorization: `Bearer ${accessToken}`,
      ...this.config.clientName && {
        'user-agent': `${this.config.clientName} ai-sdk-supergrok/${VERSION}`,
      },
    })
  }
}
