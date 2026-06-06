import type { LanguageModelV3FinishReason } from '@ai-sdk/provider'

export function mapSupergrokFinishReason(
  finishReason: string | null | undefined,
): LanguageModelV3FinishReason {
  if (finishReason == null) {
    return { unified: 'other', raw: undefined }
  }
  switch (finishReason) {
    case 'stop':
      return { unified: 'stop', raw: finishReason }
    case 'length':
      return { unified: 'length', raw: finishReason }
    case 'content_filter':
      return { unified: 'content-filter', raw: finishReason }
    case 'tool_calls':
      return { unified: 'tool-calls', raw: finishReason }
    default:
      return { unified: 'other', raw: finishReason }
  }
}
