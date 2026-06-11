import type {SupergrokModelId} from './languageModel.ts'
import type {LanguageModelV3} from '@ai-sdk/provider'
import type {FetchFunction} from '@ai-sdk/provider-utils'

import {SupergrokLanguageModel} from './languageModel.ts'
import {SupergrokTokenManager} from './tokenManager.ts'

export interface SupergrokProviderOptions {
  /**
   * xAI OAuth access token (JWT bearer).
   *
   * If provided without a refresh token, the session will fail when the
   * access token expires during a call.
   */
  accessToken?: string

  /**
   * Base URL for the xAI API.
   *
   * @default 'https://api.x.ai/v1'
   */
  baseURL?: string

  /**
   * A name identifying your client, sent in the User-Agent header.
   *
   * @example 'my_custom_client/v1'
   */
  clientName?: string

  /**
   * Custom fetch implementation for middleware / testing.
   */
  fetch?: FetchFunction

  /**
   * Called after every successful token refresh, including initial
   * access-token claims when only a refresh token was provided.
   * Use this to persist rotated token pairs.
   */
  onTokenRefresh?: (tokens: {
    accessToken: string
    expiresAt?: number
    refreshToken: string
  }) => Promise<void> | void

  /**
   * xAI OAuth refresh token.
   *
   * If provided without an access token, an access token will be claimed
   * on the first call and refreshed proactively thereafter.
   *
   * If provided together with an access token, the access token will be used
   * initially and refreshed proactively.
   */
  refreshToken?: string

  /**
   * xAI OAuth token endpoint.
   *
   * @default 'https://auth.x.ai/oauth2/token'
   */
  tokenUrl?: string
}

export interface SupergrokProvider {
  /**
   * Creates a language model instance for the given model ID.
   */
  (modelId: SupergrokModelId): LanguageModelV3
  /**
   * Creates a language model instance for the given model ID.
   */
  languageModel: (modelId: SupergrokModelId) => LanguageModelV3

  /**
   * The specification version of this provider.
   */
  readonly specificationVersion: 'v3'
}

/**
 * Creates a SuperGrok AI SDK provider that authenticates via xAI OAuth tokens
 * (SuperGrok / X Premium+ subscription).
 *
 * Supports three authentication modes:
 * - `accessToken` only — uses the token until it expires; session fails on expiry
 * - `refreshToken` only — claims an access token on first call, refreshes proactively
 * - `accessToken` + `refreshToken` — starts with the given access token, refreshes proactively
 *
 * @example
 * ```ts
 * import { generateText } from 'ai'
 * import createSupergrok from 'ai-sdk-provider-supergrok'
 *
 * const createModel = createSupergrok({
 *   clientName: 'my_custom_client/v1',
 *   accessToken: process.env.XAI_SUBSCRIPTION_ACCESS_TOKEN,
 *   refreshToken: process.env.XAI_SUBSCRIPTION_REFRESH_TOKEN,
 * })
 *
 * const model = createModel('grok-build-0.1')
 *
 * const response = await generateText({
 *   model,
 *   messages: [
 *     { role: 'system', content: 'Answer with a single emoji.' },
 *     { role: 'user', content: 'Which is the most dangerous animal?' },
 *   ],
 * })
 * ```
 */
export function createSupergrok(options: SupergrokProviderOptions = {}): SupergrokProvider {
  const {clientName,
    accessToken,
    refreshToken,
    baseURL = 'https://api.x.ai/v1',
    fetch: customFetch,
    tokenUrl,
    onTokenRefresh} = options
  if (!accessToken && !refreshToken) {
    throw new Error('ai-sdk-provider-supergrok: at least one of accessToken or refreshToken must be provided')
  }
  const tokenManager = new SupergrokTokenManager({
    clientName,
    accessToken,
    refreshToken,
    tokenUrl,
    fetch: customFetch,
    onTokenRefresh,
  })
  const languageModelFn = (modelId: SupergrokModelId): LanguageModelV3 => {
    return new SupergrokLanguageModel(modelId, {
      provider: 'supergrok',
      baseURL: baseURL.replace(/\/$/, ''),
      tokenManager,
      clientName,
      fetch: customFetch,
    })
  }
  const provider = Object.assign(languageModelFn, {
    specificationVersion: 'v3' as const,
    languageModel: languageModelFn,
  })
  return provider
}

export default createSupergrok

export {SupergrokLanguageModel} from './languageModel.ts'
export type {SupergrokModelId} from './languageModel.ts'
export {getJwtExpiresAt, SupergrokTokenManager} from './tokenManager.ts'
export type {SupergrokTokenPair} from './tokenManager.ts'
