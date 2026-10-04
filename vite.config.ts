import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Preserve previous outputs under this project's no bulk deletion rule.
  build: { emptyOutDir: false },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
