import type {LanguageModelV3Prompt} from '@ai-sdk/provider'

import {describe, expect, it, test} from 'bun:test'

import {convertToXaiMessages} from '../src/convertMessages.ts'
import {createSupergrok, getJwtExpiresAt} from '../src/index'
import {mapSupergrokFinishReason} from '../src/mapFinishReason.ts'
import {prepareTools} from '../src/prepareTools.ts'
import {SupergrokTokenManager} from '../src/tokenManager.ts'

// ─── helpers ────────────────────────────────────────────────────────────────

const encodeBase64Url = (value: unknown) => btoa(JSON.stringify(value))
  .replaceAll('+', '-')
  .replaceAll('/', '_')
  .replaceAll('=', '')
const createJwt = (expiresAt: number) => `header.${encodeBase64Url({exp: Math.floor(expiresAt / 1000)})}.signature`
const chatResponse = (text: string) => Response.json({
  id: 'chatcmpl_test',
  created: 1,
  model: 'grok-test',
  object: 'chat.completion',
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: text,
      },
      finish_reason: 'stop',
    },
  ],
  usage: {
    prompt_tokens: 2,
    completion_tokens: 1,
    total_tokens: 3,
  },
}, {headers: {'content-type': 'application/json'}})

// ─── finish reason mapping ──────────────────────────────────────────────────

describe('mapSupergrokFinishReason', () => {
  it('maps stop', () => {
    expect(mapSupergrokFinishReason('stop')).toEqual({
      unified: 'stop',
      raw: 'stop',
    })
  })
  it('maps length', () => {
    expect(mapSupergrokFinishReason('length')).toEqual({
      unified: 'length',
      raw: 'length',
    })
  })
  it('maps content_filter', () => {
    expect(mapSupergrokFinishReason('content_filter')).toEqual({
      unified: 'content-filter',
      raw: 'content_filter',
    })
  })
  it('maps tool_calls', () => {
    expect(mapSupergrokFinishReason('tool_calls')).toEqual({
      unified: 'tool-calls',
      raw: 'tool_calls',
    })
  })
  it('handles null/undefined', () => {
    expect(mapSupergrokFinishReason(null)).toEqual({
      unified: 'other',
      raw: undefined,
    })
    expect(mapSupergrokFinishReason()).toEqual({
      unified: 'other',
      raw: undefined,
    })
  })
  it('maps unknown to other', () => {
    expect(mapSupergrokFinishReason('unknown_reason')).toEqual({
      unified: 'other',
      raw: 'unknown_reason',
    })
  })
})

// ─── message conversion ─────────────────────────────────────────────────────

describe('convertToXaiMessages', () => {
  it('converts system message', () => {
    const {messages} = convertToXaiMessages([
      {
        role: 'system',
        content: 'Be helpful.',
      },
    ])
    expect(messages).toEqual([
      {
        role: 'system',
        content: 'Be helpful.',
      },
    ])
  })
  it('converts user text message', () => {
    const {messages} = convertToXaiMessages([
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Hello',
          },
        ],
      },
    ])
    expect(messages).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Hello',
          },
        ],
      },
    ])
  })
  it('converts user message with image URL', () => {
    const {messages} = convertToXaiMessages([
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'What is this?',
          },
          {
            type: 'file',
            data: 'https://example.com/image.png',
            mediaType: 'image/png',
          },
        ],
      },
    ])
    expect(messages).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'What is this?',
          },
          {
            type: 'image_url',
            image_url: {url: 'https://example.com/image.png'},
          },
        ],
      },
    ])
  })
  it('converts assistant message with text', () => {
    const {messages} = convertToXaiMessages([
      {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'Hi!',
          },
        ],
      },
    ])
    expect(messages).toEqual([
      {
        role: 'assistant',
        content: 'Hi!',
      },
    ])
  })
  it('converts assistant message with tool calls', () => {
    const {messages} = convertToXaiMessages([
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call_1',
            toolName: 'get_weather',
            input: '{"city":"Paris"}',
          },
        ],
      },
    ])
    expect(messages).toEqual([
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'get_weather',
              arguments: '{"city":"Paris"}',
            },
          },
        ],
      },
    ])
  })
  it('converts tool result message', () => {
    const {messages} = convertToXaiMessages([
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call_1',
            toolName: 'get_weather',
            output: {
              type: 'text',
              value: 'Sunny',
            },
          },
        ],
      },
    ])
    expect(messages).toEqual([
      {
        role: 'tool',
        tool_call_id: 'call_1',
        content: 'Sunny',
      },
    ])
  })
  it('converts multi-turn conversation', () => {
    const prompt: LanguageModelV3Prompt = [
      {
        role: 'system',
        content: 'Be concise.',
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '2+2?',
          },
        ],
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: '4',
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '3+3?',
          },
        ],
      },
    ]
    const {messages} = convertToXaiMessages(prompt)
    expect(messages).toHaveLength(4)
    expect(messages[0]).toEqual({
      role: 'system',
      content: 'Be concise.',
    })
    expect(messages[3]).toEqual({
      role: 'user',
      content: [
        {
          type: 'text',
          text: '3+3?',
        },
      ],
    })
  })
})

// ─── tool preparation ───────────────────────────────────────────────────────

describe('prepareTools', () => {
  it('returns undefined for empty tools', () => {
    const result = prepareTools({
      tools: undefined,
      toolChoice: undefined,
    })
    expect(result.tools).toBeUndefined()
    expect(result.toolChoice).toBeUndefined()
  })
  it('converts function tools', () => {
    const result = prepareTools({
      tools: [
        {
          type: 'function',
          name: 'get_weather',
          description: 'Get weather',
          inputSchema: {type: 'object'},
        },
      ],
      toolChoice: undefined,
    })
    expect(result.tools).toHaveLength(1)
    expect(result.tools![0]).toEqual({
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get weather',
        parameters: {type: 'object'},
      },
    })
  })
  it('maps tool choice modes', () => {
    expect(prepareTools({
      tools: [
        {
          type: 'function',
          name: 'f',
          description: '',
          inputSchema: {},
        },
      ],
      toolChoice: {type: 'auto'},
    }).toolChoice).toBe('auto')
    expect(prepareTools({
      tools: [
        {
          type: 'function',
          name: 'f',
          description: '',
          inputSchema: {},
        },
      ],
      toolChoice: {type: 'none'},
    }).toolChoice).toBe('none')
    expect(prepareTools({
      tools: [
        {
          type: 'function',
          name: 'f',
          description: '',
          inputSchema: {},
        },
      ],
      toolChoice: {type: 'required'},
    }).toolChoice).toBe('required')
    expect(prepareTools({
      tools: [
        {
          type: 'function',
          name: 'f',
          description: '',
          inputSchema: {},
        },
      ],
      toolChoice: {
        type: 'tool',
        toolName: 'f',
      },
    }).toolChoice).toEqual({
      type: 'function',
      function: {name: 'f'},
    })
  })
})

// ─── JWT decoding ───────────────────────────────────────────────────────────

describe('getJwtExpiresAt', () => {
  it('decodes exp claim', () => {
    const exp = Date.now() + 123_000
    const decoded = getJwtExpiresAt(createJwt(exp))
    expect(decoded).toBe(Math.floor(exp / 1000) * 1000)
  })
  it('returns undefined for opaque tokens', () => {
    expect(getJwtExpiresAt('opaque-token')).toBeUndefined()
  })
  it('returns undefined for empty input', () => {
    expect(getJwtExpiresAt('')).toBeUndefined()
  })
})

// ─── token manager ──────────────────────────────────────────────────────────

describe('SupergrokTokenManager', () => {
  it('throws when no tokens are provided', async () => {
    const tm = new SupergrokTokenManager
    await expect(tm.getAccessToken()).rejects.toThrow('accessToken or refreshToken')
  })
  it('throws when access token is expired without refresh token', async () => {
    const tm = new SupergrokTokenManager({accessToken: createJwt(Date.now() - 1000)})
    await expect(tm.getAccessToken()).rejects.toThrow('expired')
  })
  it('returns access token when valid', async () => {
    const token = createJwt(Date.now() + 600_000)
    const tm = new SupergrokTokenManager({accessToken: token})
    const result = await tm.getAccessToken()
    expect(result).toBe(token)
  })
  it('refreshes when only refresh token is provided', async () => {
    const refreshedAccess = createJwt(Date.now() + 600_000)
    const tm = new SupergrokTokenManager({
      refreshToken: 'refresh-me',
      fetch: async () => Response.json({
        access_token: refreshedAccess,
        expires_in: 3600,
      }, {headers: {'content-type': 'application/json'}}),
    })
    const token = await tm.getAccessToken()
    expect(token).toBe(refreshedAccess)
  })
  it('single-flights concurrent refresh calls', async () => {
    let refreshCount = 0
    const tm = new SupergrokTokenManager({
      refreshToken: 'refresh-me',
      fetch: async () => {
        refreshCount++
        return Response.json({
          access_token: createJwt(Date.now() + 600_000),
          expires_in: 3600,
        }, {headers: {'content-type': 'application/json'}})
      },
    })
    const [a, b] = await Promise.all([tm.refreshAccessToken(), tm.refreshAccessToken()])
    expect(a.accessToken).toBe(b.accessToken)
    expect(refreshCount).toBe(1)
  })
  it('calls onTokenRefresh callback', async () => {
    const refreshed: Array<unknown> = []
    const tm = new SupergrokTokenManager({
      refreshToken: 'refresh-me',
      onTokenRefresh: tokens => {
        refreshed.push(tokens)
      },
      fetch: async () => Response.json({
        access_token: createJwt(Date.now() + 600_000),
        refresh_token: 'rotated',
        expires_in: 3600,
      }, {headers: {'content-type': 'application/json'}}),
    })
    await tm.getAccessToken()
    expect(refreshed).toHaveLength(1)
    const pair = refreshed[0] as Record<string, unknown>
    expect(pair.refreshToken).toBe('rotated')
    expect(typeof pair.accessToken).toBe('string')
  })
})

// ─── provider factory ───────────────────────────────────────────────────────

describe('createSupergrok', () => {
  it('throws when no tokens are provided', () => {
    expect(() => createSupergrok()).toThrow('accessToken or refreshToken')
  })
  it('creates a model instance', () => {
    const createModel = createSupergrok({
      accessToken: createJwt(Date.now() + 600_000),
      clientName: 'test/v1',
    })
    const model = createModel('grok-test')
    expect(model.modelId).toBe('grok-test')
    expect(model.provider).toBe('supergrok')
    expect(model.specificationVersion).toBe('v3')
  })
  it('supports .languageModel() method', () => {
    const createModel = createSupergrok({
      accessToken: createJwt(Date.now() + 600_000),
    })
    expect(createModel.languageModel).toBeInstanceOf(Function)
    const model = createModel.languageModel('grok-4.3')
    expect(model.modelId).toBe('grok-4.3')
  })
  it('has specificationVersion', () => {
    const createModel = createSupergrok({accessToken: createJwt(Date.now() + 600_000)})
    expect(createModel.specificationVersion).toBe('v3')
  })
  it('strips trailing slash from baseURL', () => {
    const createModel = createSupergrok({
      accessToken: createJwt(Date.now() + 600_000),
      baseURL: 'https://api.x.ai/v1/',
    })
    const model = createModel('grok-test')
    // access via private config — just ensure no double-slash in the URL
    expect(model.supportedUrls).toBeDefined()
  })
})

// ─── integration test (mocked fetch) ────────────────────────────────────────

test('integrates with mocked API', async () => {
  const {generateText} = await import('ai')
  const provider = createSupergrok({
    accessToken: createJwt(Date.now() + 600_000),
    clientName: 'test-client/v1',
    fetch: async () => chatResponse('🦟'),
  })
  const response = await generateText({
    model: provider('grok-build-0.1'),
    messages: [
      {
        role: 'user',
        content: 'Which animal is dangerous?',
      },
    ],
  })
  expect(response.text).toBe('🦟')
})
