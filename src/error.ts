import {createJsonErrorResponseHandler} from '@ai-sdk/provider-utils'
import zod from 'zod'

const xaiErrorSchema = zod.object({
  error: zod.object({
    message: zod.string(),
    type: zod.string().nullish(),
    code: zod.string().nullish(),
  }),
})

export const supergrokFailedResponseHandler = createJsonErrorResponseHandler({
  errorSchema: xaiErrorSchema,
  errorToMessage: error => error.error.message,
  isRetryable: (response, error) => {
    if (response.status != null && response.status >= 500) {
      return true
    }
    if (response.status === 429) {
      return true
    }
    if (error?.error?.code === 'The service is currently unavailable') {
      return true
    }
    return false
  },
})
