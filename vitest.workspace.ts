import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  {
    test: {
      name: 'shared',
      root: './packages/shared',
      environment: 'node',
    },
  },
])
