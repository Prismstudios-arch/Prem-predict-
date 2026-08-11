import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

/**
 * Tests here are deliberately pure — design-token maths, contrast, formatting.
 * No React Native renderer, so they run in plain Node in milliseconds and need
 * no extra test dependencies (CLAUDE.md §3.1 keeps the dependency list short).
 *
 * Component rendering and VoiceOver order still need a device; see §11 Phase 4.
 */
export default defineConfig({
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
