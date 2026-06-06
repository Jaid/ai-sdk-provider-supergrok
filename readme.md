# ai-sdk-provider-supergrok

Vercel AI SDK provider for SuperGrok — use your xAI OAuth subscription tokens (SuperGrok / X Premium+) to call Grok models without an API key.

Your subscription’s included Grok quota is used instead of API credit.

## Install

```bash
bun add ai-sdk-provider-supergrok ai
```

## Usage

```ts
import { generateText } from 'ai'
import { createSupergrok } from 'ai-sdk-provider-supergrok'

const createModel = createSupergrok({
  clientName: 'my_app/v1',
  accessToken: process.env.XAI_SUBSCRIPTION_ACCESS_TOKEN,
  refreshToken: process.env.XAI_SUBSCRIPTION_REFRESH_TOKEN,
})

const model = createModel('grok-build-0.1')

const response = await generateText({
  model,
  messages: [
    { role: 'system', content: 'Answer with a single emoji.' },
    { role: 'user', content: 'Which is the most dangerous animal?' },
  ],
})

console.log(response.text) // 🦟
```

## Authentication

The provider supports three authentication modes:

| Mode | Behavior |
|------|----------|
| `accessToken` only | Uses the token until it expires; session fails on expiry |
| `refreshToken` only | Claims an access token on the first call, refreshes proactively |
| `accessToken` + `refreshToken` | Starts with the given access token, refreshes proactively |

Token refresh uses the Grok-CLI OAuth client at `https://auth.x.ai/oauth2/token`. JWT `exp` claims and `expires_in` values are inspected to decide when to refresh (120 s skew).

### Reactive 401 recovery

If the access token expires mid-flight despite proactive refresh (e.g. for opaque non-JWT tokens), the provider catches the 401, refreshes the token, and retries the request once — provided a refresh token was configured.

### Token persistence

Use `onTokenRefresh` to persist rotated token pairs:

```ts
const createModel = createSupergrok({
  accessToken: loadAccessToken(),
  refreshToken: loadRefreshToken(),
  onTokenRefresh({ accessToken, refreshToken, expiresAt }) {
    saveTokens({ accessToken, refreshToken, expiresAt })
  },
})
```

## API

### `createSupergrok(options)`

Returns a `SupergrokProvider`.

```ts
interface SupergrokProviderOptions {
  clientName?: string           // sent as User-Agent header
  accessToken?: string          // xAI OAuth bearer token
  refreshToken?: string         // xAI OAuth refresh token
  baseURL?: string              // default: 'https://api.x.ai/v1'
  fetch?: FetchFunction         // custom fetch for middleware / testing
  tokenUrl?: string             // default: 'https://auth.x.ai/oauth2/token'
  onTokenRefresh?: (tokens: {
    accessToken: string
    refreshToken: string
    expiresAt?: number
  }) => void | Promise<void>
}
```

The returned provider is both callable and has a `.languageModel()` method:

```ts
const model = createModel('grok-4.3')
// equivalent to:
const model = createModel.languageModel('grok-4.3')
```

### Provider options

xAI-specific parameters can be passed via `providerOptions.supergrok`:

```ts
const response = await generateText({
  model,
  messages: [...],
  providerOptions: {
    supergrok: {
      reasoningEffort: 'high',
      logprobs: true,
      topLogprobs: 3,
    },
  },
})
```

| Option | Type | Description |
|--------|------|-------------|
| `reasoningEffort` | `'none' \| 'low' \| 'medium' \| 'high'` | Controls reasoning depth for Grok reasoning models |
| `logprobs` | `boolean` | Whether to return log probabilities |
| `topLogprobs` | `number` (0–8) | Number of top log probabilities to return |
| `parallelFunctionCalling` | `boolean` | Enable parallel tool calls |

### Exported utilities

```ts
import { SupergrokTokenManager, getJwtExpiresAt } from 'ai-sdk-provider-supergrok'
```

## Models

Any xAI chat model ID works:

- `grok-build-0.1`
- `grok-3`
- `grok-4.3`
- `grok-4.20-reasoning`
- etc.

## License

MIT
