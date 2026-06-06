import zod from 'zod'

const webSourceSchema = zod.object({
  type: zod.literal('web'),
  country: zod.string().length(2).optional(),
  excludedWebsites: zod.array(zod.string()).max(5).optional(),
  allowedWebsites: zod.array(zod.string()).max(5).optional(),
  safeSearch: zod.boolean().optional(),
})
const xSourceSchema = zod.object({
  type: zod.literal('x'),
  excludedXHandles: zod.array(zod.string()).optional(),
  includedXHandles: zod.array(zod.string()).optional(),
  postFavoriteCount: zod.int().optional(),
  postViewCount: zod.int().optional(),
  xHandles: zod.array(zod.string()).optional(),
})
const newsSourceSchema = zod.object({
  type: zod.literal('news'),
  country: zod.string().length(2).optional(),
  excludedWebsites: zod.array(zod.string()).max(5).optional(),
  safeSearch: zod.boolean().optional(),
})
const rssSourceSchema = zod.object({
  type: zod.literal('rss'),
  links: zod.array(zod.url()).max(1),
})
const searchSourceSchema = zod.discriminatedUnion('type', [
  webSourceSchema,
  xSourceSchema,
  newsSourceSchema,
  rssSourceSchema,
])

/**
 * Zod schema for xAI provider options passed via `providerOptions.supergrok`.
 *
 * These map directly to xAI-specific chat completion parameters that are not
 * covered by the standard AI SDK call options.
 */
export const supergrokProviderOptionsSchema = zod.object({
  reasoningEffort: zod.enum(['none', 'low', 'medium', 'high']).optional(),
  logprobs: zod.boolean().optional(),
  topLogprobs: zod.int().min(0).max(8).optional(),
  parallelFunctionCalling: zod.boolean().optional(),

  /**
   * @deprecated xAI has deprecated Live Search (`search_parameters`).
   * Use the Agent Tools API (`web_search` / `x_search` tools) instead.
   * @see https://docs.x.ai/docs/guides/tools/overview
   */
  searchParameters: zod
    .object({
      mode: zod.enum(['off', 'auto', 'on']),
      returnCitations: zod.boolean().optional(),
      fromDate: zod.string().optional(),
      toDate: zod.string().optional(),
      maxSearchResults: zod.number().min(1).max(50).optional(),
      sources: zod.array(searchSourceSchema).optional(),
    })
    .optional(),
})

export type SupergrokProviderOptions = zod.infer<typeof supergrokProviderOptionsSchema>
