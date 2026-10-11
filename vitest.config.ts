import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  // Testes criam pastas temporárias; o runner Windows do CI é bem mais lento em disco.
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node', testTimeout: 20_000 }
})
