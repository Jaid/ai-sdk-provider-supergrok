import { z } from 'zod/v4'

const webSourceSchema = z.object({
  type: z.literal('web'),
  country: z.string().length(2).optional(),
  excludedWebsites: z.array(z.string()).max(5).optional(),
  allowedWebsites: z.array(z.string()).max(5).optional(),
  safeSearch: z.boolean().optional(),
})

const xSourceSchema = z.object({
  type: z.literal('x'),
  excludedXHandles: z.array(z.string()).optional(),
  includedXHandles: z.array(z.string()).optional(),
  postFavoriteCount: z.number().int().optional(),
  postViewCount: z.number().int().optional(),
  xHandles: z.array(z.string()).optional(),
})

const newsSourceSchema = z.object({
  type: z.literal('news'),
  country: z.string().length(2).optional(),
  excludedWebsites: z.array(z.string()).max(5).optional(),
  safeSearch: z.boolean().optional(),
})

const rssSourceSchema = z.object({
  type: z.literal('rss'),
  links: z.array(z.string().url()).max(1),
})

const searchSourceSchema = z.discriminatedUnion('type', [
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
export const supergrokProviderOptionsSchema = z.object({
  reasoningEffort: z.enum(['none', 'low', 'medium', 'high']).optional(),
  logprobs: z.boolean().optional(),
  topLogprobs: z.number().int().min(0).max(8).optional(),
  parallelFunctionCalling: z.boolean().optional(),

  /**
   * @deprecated xAI has deprecated Live Search (`search_parameters`).
   * Use the Agent Tools API (`web_search` / `x_search` tools) instead.
   * @see https://docs.x.ai/docs/guides/tools/overview
   */
  searchParameters: z
    .object({
      mode: z.enum(['off', 'auto', 'on']),
      returnCitations: z.boolean().optional(),
      fromDate: z.string().optional(),
      toDate: z.string().optional(),
      maxSearchResults: z.number().min(1).max(50).optional(),
      sources: z.array(searchSourceSchema).optional(),
    })
    .optional(),
})

export type SupergrokProviderOptions = z.infer<typeof supergrokProviderOptionsSchema>
