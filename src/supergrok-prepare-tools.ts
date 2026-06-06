import type { LanguageModelV3CallOptions, SharedV3Warning } from '@ai-sdk/provider'

type XaiTool = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

type XaiToolChoice =
  | 'none'
  | 'auto'
  | 'required'
  | { type: 'function'; function: { name: string } }

/**
 * Converts AI SDK v3 tool definitions into the xAI chat completions format.
 */
export function prepareTools({
  tools,
  toolChoice,
}: {
  tools: LanguageModelV3CallOptions['tools']
  toolChoice: LanguageModelV3CallOptions['toolChoice']
}): {
  tools: XaiTool[] | undefined
  toolChoice: XaiToolChoice | undefined
  toolWarnings: SharedV3Warning[]
} {
  const toolWarnings: SharedV3Warning[] = []

  if (!tools || tools.length === 0) {
    return { tools: undefined, toolChoice: undefined, toolWarnings }
  }

  const xaiTools: XaiTool[] = []
  for (const tool of tools) {
    if (tool.type === 'function') {
      xaiTools.push({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description ?? '',
          parameters: tool.inputSchema as Record<string, unknown>,
        },
      })
    } else if (tool.type === 'provider') {
      toolWarnings.push({
        type: 'unsupported',
        feature: `provider-defined tool: ${tool.id}`,
      })
    }
  }

  let xaiToolChoice: XaiToolChoice | undefined
  if (toolChoice) {
    switch (toolChoice.type) {
      case 'none':
        xaiToolChoice = 'none'
        break
      case 'auto':
        xaiToolChoice = 'auto'
        break
      case 'required':
        xaiToolChoice = 'required'
        break
      case 'tool':
        xaiToolChoice = {
          type: 'function',
          function: { name: toolChoice.toolName },
        }
        break
    }
  }

  return {
    tools: xaiTools.length > 0 ? xaiTools : undefined,
    toolChoice: xaiToolChoice,
    toolWarnings,
  }
}
