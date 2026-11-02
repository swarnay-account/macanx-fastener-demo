/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // `--mode artifact` builds the copy hosted as a Claude artifact: relative paths,
  // shown inside Claude's page frame, where printing is not available.
  const artifact = mode === 'artifact'
  return {
    base: artifact ? './' : '/',
    plugins: [react()],
    define: {
      // Hostnames this build may run on, comma separated. Empty means "anywhere".
      __ALLOWED_HOSTS__: JSON.stringify(env.DEMO_ALLOWED_HOSTS ?? ''),
      __ARTIFACT__: JSON.stringify(artifact),
    },
    build: { sourcemap: false, minify: true, cssCodeSplit: false },
    test: { environment: 'node', include: ['src/**/*.test.ts'] },
  }
})
