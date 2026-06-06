// xAI's public Grok-CLI OAuth client ID. Shipped with the Grok CLI for
// desktop OAuth flows; reused here for token refresh. Source of truth across
// OpenCode, Hermes and KiloCode implementations.
const XAI_OAUTH_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828'
const XAI_OAUTH_TOKEN_URL = 'https://auth.x.ai/oauth2/token'
// Refresh the access token a little before its JWT exp so that a single
// long-running request does not have to recover from a mid-flight 401.
const ACCESS_TOKEN_REFRESH_SKEW_MS = 120_000

//
// Result of a successful token refresh that callers can persist.
//
export interface SupergrokTokenPair {
  accessToken: string
  expiresAt?: number
  refreshToken: string
}

export interface SupergrokTokenManagerOptions {
  accessToken?: string
  clientId?: string
  clientName?: string
  fetch?: typeof globalThis.fetch
  now?: () => number
  onTokenRefresh?: (tokens: SupergrokTokenPair) => Promise<void> | void
  refreshToken?: string
  tokenUrl?: string
}

type TokenRefreshResponse = {
  access_token: string
  expires_in?: number
  refresh_token?: string
  token_type?: string
}

//
// Decode a JWT `exp` claim without verifying the signature. Returns the expiry
// in milliseconds since the Unix epoch, or `undefined` for opaque (non-JWT)
// tokens. Safe for non-trust decisions only.
//
export function getJwtExpiresAt(token: string): number | undefined {
  const parts = token.split('.')
  if (parts.length < 2) {
    return undefined
  }
  try {
    let payload = parts[1].replaceAll('-', '+').replaceAll('_', '/')
    while (payload.length % 4 !== 0) {
      payload += '='
    }
    const claims = JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as {exp?: unknown}
    if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) {
      return undefined
    }
    return claims.exp * 1000
  } catch {
    return undefined
  }
}

//
// Manages xAI OAuth tokens: stores the current access/refresh pair,
// handles proactive refresh before expiry, and runs single-flight refresh
// so multiple concurrent callers share exactly one HTTP call.
//
export class SupergrokTokenManager {
  readonly clientId: string
  readonly clientName: string | undefined
  readonly fetch: typeof globalThis.fetch
  readonly now: () => number
  readonly onTokenRefresh: ((tokens: SupergrokTokenPair) => Promise<void> | void) | undefined
  readonly refreshSkewMs: number
  readonly tokenUrl: string

  #accessToken: string | undefined
  #accessTokenExpiresAt: number | undefined
  #refreshPromise: Promise<SupergrokTokenPair> | undefined
  #refreshToken: string | undefined

  constructor(options: SupergrokTokenManagerOptions = {}) {
    this.clientName = options.clientName
    this.#accessToken = options.accessToken
    this.#accessTokenExpiresAt = options.accessToken ? getJwtExpiresAt(options.accessToken) : undefined
    this.#refreshToken = options.refreshToken
    this.tokenUrl = options.tokenUrl ?? XAI_OAUTH_TOKEN_URL
    this.clientId = options.clientId ?? XAI_OAUTH_CLIENT_ID
    this.refreshSkewMs = ACCESS_TOKEN_REFRESH_SKEW_MS
    this.fetch = options.fetch ?? globalThis.fetch
    this.now = options.now ?? (() => Date.now())
    this.onTokenRefresh = options.onTokenRefresh
  }

  get accessToken(): string | undefined {
    return this.#accessToken
  }
  get accessTokenExpiresAt(): number | undefined {
    return this.#accessTokenExpiresAt
  }
  get refreshToken(): string | undefined {
    return this.#refreshToken
  }

  /** True if the access token JWT has expired (or will expire within `skewMs`). */
  accessTokenIsExpired(skewMs = 0): boolean {
    if (this.#accessTokenExpiresAt == null) {
      return false
    }
    return this.#accessTokenExpiresAt <= this.now() + Math.max(0, skewMs)
  }

  /**
   * Returns a valid access token, refreshing it first if a refresh token is
   * available and the current token is within the skew window.
   */
  async getAccessToken(): Promise<string> {
    if (this.#refreshToken && (!this.#accessToken || this.accessTokenIsExpired(this.refreshSkewMs))) {
      return (await this.refreshAccessToken()).accessToken
    }
    if (!this.#accessToken) {
      throw new Error('SuperGrok authentication requires either accessToken or refreshToken.')
    }
    if (this.accessTokenIsExpired()) {
      throw new Error('The SuperGrok access token is expired and no refresh token was provided.')
    }
    return this.#accessToken
  }

  /** Whether a refresh token is available for rotational refresh. */
  hasRefreshToken(): boolean {
    return Boolean(this.#refreshToken)
  }

  /**
   * Force-refresh the access token using the stored refresh token.
   * Throws if no refresh token is available.
   * Multiple concurrent callers share a single in-flight HTTP refresh.
   */
  async refreshAccessToken(): Promise<SupergrokTokenPair> {
    if (!this.#refreshToken) {
      throw new Error('Cannot refresh: no refresh token available')
    }
    this.#refreshPromise ??= this.#doRefresh().finally(() => {
      this.#refreshPromise = undefined
    })
    return this.#refreshPromise
  }

  async #doRefresh(): Promise<SupergrokTokenPair> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.#refreshToken!,
      client_id: this.clientId,
    })
    const headers = new Headers({
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    })
    if (this.clientName) {
      headers.set('user-agent', this.clientName)
    }
    const response = await this.fetch(this.tokenUrl, {
      method: 'POST',
      headers,
      body: body.toString(),
    })
    const responseText = await response.text()
    let data: TokenRefreshResponse | undefined
    try {
      if (responseText) {
        data = JSON.parse(responseText) as TokenRefreshResponse
      }
    } catch {
      // parse failure handled below
    }
    if (!response.ok) {
      throw new Error(`xAI token refresh failed (${response.status})${responseText ? `: ${responseText}` : ''}`)
    }
    if (!data?.access_token || typeof data.access_token !== 'string') {
      throw new Error(`xAI token refresh response missing access_token: ${responseText}`)
    }
    this.#accessToken = data.access_token
    if (data.refresh_token) {
      this.#refreshToken = data.refresh_token
    }
    this.#accessTokenExpiresAt
      = typeof data.expires_in === 'number' && data.expires_in > 0 ? this.now() + data.expires_in * 1000 : getJwtExpiresAt(data.access_token)
    const pair: SupergrokTokenPair = {
      accessToken: this.#accessToken,
      refreshToken: this.#refreshToken!,
      expiresAt: this.#accessTokenExpiresAt,
    }
    await this.onTokenRefresh?.(pair)
    return pair
  }
}
