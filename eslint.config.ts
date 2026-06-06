import type {Linter} from 'eslint'

import {makeEslintConfig} from 'eslint-config-jaid'
import eslintPluginZod from 'eslint-plugin-zod'

const config: Array<Linter.Config> = [
  {
    ignores: ['dist/**', 'out/**', 'private/**', 'temp/**', 'test/lib/fixtures/content/**'],
  },
  ...makeEslintConfig(),
  {
    plugins: {
      zod: eslintPluginZod,
    },
    rules: {
      'zod/no-optional-and-default-together': 'warn',
      'zod/array-style': 'warn',
      'zod/no-empty-custom-schema': 'warn',
      'zod/no-number-schema-with-finite': 'warn',
      'zod/no-number-schema-with-int': 'warn',
      'zod/no-number-schema-with-is-finite': 'warn',
      'zod/no-number-schema-with-is-int': 'warn',
      'zod/no-number-schema-with-safe': 'warn',
      'zod/no-number-schema-with-step': 'warn',
      'zod/no-promise-schema': 'warn',
      'zod/no-schema-with-is-nullable': 'warn',
      'zod/no-schema-with-is-optional': 'warn',
      'zod/no-string-schema-with-uuid': 'warn',
      'zod/prefer-enum-over-literal-union': 'warn',
      'zod/prefer-loose-object': 'warn',
      'zod/prefer-meta-last': 'warn',
      'zod/prefer-strict-object': 'warn',
      'zod/prefer-top-level-string-formats': 'warn',
      'zod/prefer-trim-before-string-length-checks': 'warn',
    },
  },
]

export default config
