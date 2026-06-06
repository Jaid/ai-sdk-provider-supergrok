import { createJsonErrorResponseHandler } from '@ai-sdk/provider-utils'
import { z } from 'zod/v4'

const xaiErrorSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.string().nullish(),
    code: z.string().nullish(),
  }),
})

export const supergrokFailedResponseHandler = createJsonErrorResponseHandler({
  errorSchema: xaiErrorSchema,
  errorToMessage: error => error.error.message,
  isRetryable: (response, error) => {
    if (response.status != null && response.status >= 500) return true
    if (response.status === 429) return true
    if (error?.error?.code === 'The service is currently unavailable') return true
    return false
  },
})
