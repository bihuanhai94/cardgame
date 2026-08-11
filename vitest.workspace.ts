import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  {
    test: {
      name: 'shared',
      root: './packages/shared',
      environment: 'node',
    },
  },
  {
    test: {
      name: 'server',
      root: './packages/server',
      environment: 'node',
    },
  },
  './packages/web/vite.config.ts',
])
