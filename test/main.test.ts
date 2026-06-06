import {expect, test} from 'bun:test'

const {default: aiSdkProviderSupergrok} = await import('#src/main.ts')

test('should run', () => {
  const result = aiSdkProviderSupergrok()
  expect(result).toBe('ai-sdk-provider-supergrok') // TODO Test actual functionality
})
