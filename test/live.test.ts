import {describe, expect, it} from 'bun:test'

import {generateText, Output, streamText} from 'ai'
import {z} from 'zod/v4'

import {createSupergrok, getJwtExpiresAt} from '../src/index.ts'

// ─── env validation ─────────────────────────────────────────────────────────

const accessToken = process.env.SUPERGROK_ACCESS_TOKEN
const refreshToken = process.env.SUPERGROK_REFRESH_TOKEN
const hasTokens = Boolean(accessToken || refreshToken)
// Create one shared provider for all live tests so that any token refresh
// (which rotates the refresh token on the xAI side) happens at most once.
// The rotated tokens are cached inside the provider's tokenManager for the
// lifetime of this test run.
let sharedCreateModel: ReturnType<typeof createSupergrok> | null = null
if (hasTokens) {
  sharedCreateModel = createSupergrok({
    accessToken,
    refreshToken,
    clientName: 'live-test/v1',
  })
}

// ─── token inspection (offline, no network) ─────────────────────────────────

describe('token inspection (offline)', () => {
  it('decodes JWT exp from SUPERGROK_ACCESS_TOKEN', () => {
    if (!accessToken) {
      return
    }
    const exp = getJwtExpiresAt(accessToken)
    expect(exp).toBeNumber()
    // Expiry should be in the future or very recent past (not epoch 0)
    expect(exp).toBeGreaterThan(1_000_000_000_000)
  })

  it('detects whether the access token has an exp claim', () => {
    if (!accessToken) {
      return
    }
    const exp = getJwtExpiresAt(accessToken)
    if (exp !== undefined) {
      const now = Date.now()
      const isExpired = exp <= now
      // Log for informational purposes; just ensure we don't crash
      expect(typeof isExpired).toBe('boolean')
    }
  })
})

// ─── provider creation (offline) ────────────────────────────────────────────

describe('createSupergrok (offline)', () => {
  it('creates provider with env tokens', () => {
    if (!hasTokens || !sharedCreateModel) {
      return
    }
    expect(sharedCreateModel.specificationVersion).toBe('v3')
    expect(sharedCreateModel.languageModel).toBeInstanceOf(Function)
  })
  it('creates a model instance with correct metadata', () => {
    if (!hasTokens || !sharedCreateModel) {
      return
    }
    const model = sharedCreateModel('grok-build-0.1')
    expect(model.modelId).toBe('grok-build-0.1')
    expect(model.provider).toBe('supergrok')
    expect(model.specificationVersion).toBe('v3')
  })
  it('supports .languageModel() method alias', () => {
    if (!hasTokens || !sharedCreateModel) {
      return
    }
    const model = sharedCreateModel.languageModel('grok-4.3')
    expect(model.modelId).toBe('grok-4.3')
  })
})

// ─── generateText (live API) ────────────────────────────────────────────────

describe('generateText (live)', () => {
  it('generates text with a simple prompt', async () => {
    if (!hasTokens || !sharedCreateModel) {
      return
    }
    const response = await generateText({
      model: sharedCreateModel('grok-build-0.1'),
      system: 'Answer with a single emoji and nothing else.',
      messages: [
        {
          role: 'user',
          content: 'Which is the most dangerous animal?',
        },
      ],
    })
    expect(response.text).toBeString()
    expect(response.text.length).toBeGreaterThan(0)
    expect(response.finishReason).toBe('stop')
    expect(response.totalUsage.inputTokens).toBeGreaterThan(0)
    expect(response.totalUsage.outputTokens).toBeGreaterThan(0)
  })
  it('generates text with maxOutputTokens', async () => {
    if (!hasTokens || !sharedCreateModel) {
      return
    }
    const response = await generateText({
      model: sharedCreateModel('grok-build-0.1'),
      maxOutputTokens: 10,
      messages: [
        {
          role: 'user',
          content: 'Tell me a long story.',
        },
      ],
    })
    expect(response.text).toBeString()
    // With only 10 tokens, output should be short
    expect(response.totalUsage.outputTokens).toBeLessThanOrEqual(50)
  })
  it('generates text with temperature 0 (deterministic)', async () => {
    if (!hasTokens || !sharedCreateModel) {
      return
    }
    const response = await generateText({
      model: sharedCreateModel('grok-build-0.1'),
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: 'What is 2+2? Reply with just the number.',
        },
      ],
    })
    // With temp 0, should consistently give "4"
    expect(response.text.trim()).toMatch(/4/)
  })
})

// ─── streamText (live API) ──────────────────────────────────────────────────

describe('streamText (live)', () => {
  it('streams text from the API', async () => {
    if (!hasTokens || !sharedCreateModel) {
      return
    }
    const result = streamText({
      model: sharedCreateModel('grok-build-0.1'),
      messages: [
        {
          role: 'user',
          content: 'Count from 1 to 3, one per line.',
        },
      ],
    })
    const chunks: Array<string> = []
    for await (const chunk of result.textStream) {
      chunks.push(chunk)
    }
    const fullText = chunks.join('')
    expect(fullText.length).toBeGreaterThan(0)
    expect(fullText).toMatch(/1/)
    expect(fullText).toMatch(/2/)
    expect(fullText).toMatch(/3/)
  })
  it('provides totalUsage after streaming', async () => {
    if (!hasTokens || !sharedCreateModel) {
      return
    }
    const result = streamText({
      model: sharedCreateModel('grok-build-0.1'),
      messages: [
        {
          role: 'user',
          content: 'Say hello.',
        },
      ],
    })
    // Consume the stream
    for await (const _ of result.textStream) {
      // drain
    }
    const usage = await result.totalUsage
    expect(usage).toBeDefined()
    expect(usage.inputTokens).toBeGreaterThan(0)
    expect(usage.outputTokens).toBeGreaterThan(0)
  })
  it('provides finish reason after streaming', async () => {
    if (!hasTokens || !sharedCreateModel) {
      return
    }
    const result = streamText({
      model: sharedCreateModel('grok-build-0.1'),
      messages: [
        {
          role: 'user',
          content: 'Say hi.',
        },
      ],
    })
    for await (const _ of result.textStream) {
      // drain
    }
    const finishReason = await result.finishReason
    expect(finishReason).toBe('stop')
  })
})

// ─── structured output (live API) ───────────────────────────────────────────

describe('structured output (live)', () => {
  it('generates structured JSON output', async () => {
    if (!hasTokens || !sharedCreateModel) {
      return
    }
    const response = await generateText({
      model: sharedCreateModel('grok-build-0.1'),
      output: Output.object({
        schema: z.object({
          name: z.string(),
          age: z.number(),
          city: z.string(),
        }),
      }),
      messages: [
        {
          role: 'user',
          content: 'Generate a random person profile.',
        },
      ],
    })
    expect(response.output).toBeDefined()
    expect(typeof response.output.name).toBe('string')
    expect(typeof response.output.age).toBe('number')
    expect(typeof response.output.city).toBe('string')
  })
})

// ─── provider options (live API) ────────────────────────────────────────────

describe('providerOptions (live)', () => {
  it('passes reasoningEffort', async () => {
    if (!hasTokens || !sharedCreateModel) {
      return
    }
    const response = await generateText({
      model: sharedCreateModel('grok-3'),
      messages: [
        {
          role: 'user',
          content: 'Answer with just "ok".',
        },
      ],
      providerOptions: {
        supergrok: {
          reasoningEffort: 'low',
        },
      },
    })
    expect(response.text).toBeString()
    expect(response.finishReason).toBe('stop')
  })
  it('passes logprobs and topLogprobs', async () => {
    if (!hasTokens || !sharedCreateModel) {
      return
    }
    const response = await generateText({
      model: sharedCreateModel('grok-build-0.1'),
      messages: [
        {
          role: 'user',
          content: 'Say hello.',
        },
      ],
      providerOptions: {
        supergrok: {
          logprobs: true,
          topLogprobs: 3,
        },
      },
    })
    expect(response.text).toBeString()
    expect(response.finishReason).toBe('stop')
  })
  it('passes parallelFunctionCalling', async () => {
    if (!hasTokens || !sharedCreateModel) {
      return
    }
    const response = await generateText({
      model: sharedCreateModel('grok-build-0.1'),
      messages: [
        {
          role: 'user',
          content: 'Say ok in lowercase.',
        },
      ],
      providerOptions: {
        supergrok: {
          parallelFunctionCalling: false,
        },
      },
    })
    expect(response.text).toBeString()
    expect(response.finishReason).toBe('stop')
  })
})

// ─── multiple model IDs ─────────────────────────────────────────────────────

describe('model IDs (live)', () => {
  it('works with grok-build-0.1', async () => {
    if (!hasTokens || !sharedCreateModel) {
      return
    }
    const response = await generateText({
      model: sharedCreateModel('grok-build-0.1'),
      maxOutputTokens: 10,
      messages: [
        {
          role: 'user',
          content: 'Respond with just "yes".',
        },
      ],
    })
    expect(response.text.toLowerCase()).toMatch(/yes/)
  })
  it('works with grok-3', async () => {
    if (!hasTokens || !sharedCreateModel) {
      return
    }
    const response = await generateText({
      model: sharedCreateModel('grok-3'),
      maxOutputTokens: 10,
      messages: [
        {
          role: 'user',
          content: 'Respond with just "yes".',
        },
      ],
    })
    expect(response.text.toLowerCase()).toMatch(/yes/)
  })
})
