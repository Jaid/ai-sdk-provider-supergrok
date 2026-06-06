import type {LanguageModelV3Prompt, SharedV3Warning} from '@ai-sdk/provider'

type XaiContentPart
  = | {image_url: {detail?: 'auto' | 'high' | 'low'
    url: string}
  type: 'image_url'}
  | {text: string
    type: 'text'}

type XaiMessage = {
  content: Array<XaiContentPart> | string
  name?: string
  role: 'assistant' | 'system' | 'tool' | 'user'
  tool_call_id?: string
  tool_calls?: Array<XaiToolCall>
}

type XaiToolCall = {
  function: {arguments: string
    name: string}
  id: string
  type: 'function'
}

/**
 * Converts an AI SDK v3 prompt into the xAI chat completions message format.
 */
export function convertToXaiMessages(prompt: LanguageModelV3Prompt): {messages: Array<XaiMessage>
  warnings: Array<SharedV3Warning>} {
  const messages: Array<XaiMessage> = []
  const warnings: Array<SharedV3Warning> = []
  for (const message of prompt) {
    switch (message.role) {
      case 'system': {
        messages.push({
          role: 'system',
          content: message.content,
        })
        break
      }
      case 'user': {
        const parts: Array<XaiContentPart> = []
        for (const part of message.content) {
          if (part.type === 'text') {
            parts.push({
              type: 'text',
              text: part.text,
            })
          } else if (part.type === 'file') {
            const url = resolveFileUrl(part.data)
            if (url) {
              parts.push({
                type: 'image_url',
                image_url: {url},
              })
            }
          }
        }
        messages.push({
          role: 'user',
          content: parts,
        })
        break
      }
      case 'assistant': {
        const textParts: Array<string> = []
        const toolCalls: Array<XaiToolCall> = []
        for (const part of message.content) {
          if (part.type === 'text') {
            textParts.push(part.text)
          } else if (part.type === 'tool-call') {
            const args
              = typeof part.input === 'string' ? part.input : JSON.stringify(part.input)
            toolCalls.push({
              id: part.toolCallId,
              type: 'function',
              function: {
                name: part.toolName,
                arguments: args,
              },
            })
          }
        }
        messages.push({
          role: 'assistant',
          content: textParts.length > 0 ? textParts.join('\n') : '',
          ...toolCalls.length > 0 && {tool_calls: toolCalls},
        })
        break
      }
      case 'tool': {
        for (const part of message.content) {
          if (part.type === 'tool-result') {
            let output: string
            switch (part.output.type) {
              case 'text':
              case 'error-text': {
                output = part.output.value
                break
              }
              case 'json':
              case 'error-json':
              case 'content': {
                output = JSON.stringify(part.output.value)
                break
              }
              case 'execution-denied': {
                output = part.output.reason ?? 'Execution denied'
                break
              }
              default: {
                output = JSON.stringify(part.output)
              }
            }
            messages.push({
              role: 'tool',
              tool_call_id: part.toolCallId,
              content: output,
            })
          }
        }
        break
      }
    }
  }
  return {
    messages,
    warnings,
  }
}

function resolveFileUrl(data: unknown): string {
  if (data instanceof URL) {
    return data.href
  }
  if (typeof data === 'string') {
    if (data.startsWith('http://') || data.startsWith('https://') || data.startsWith('data:')) {
      return data
    }
    // assume raw base64 for image/png
    return `data:image/png;base64,${data}`
  }
  if (data instanceof Uint8Array) {
    return `data:image/png;base64,${Buffer.from(data).toString('base64')}`
  }
  return ''
}
