import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    exclude: [
      ...configDefaults.exclude,
      '**/e2e/**',
      'mock-base44-app/**',
      'mock-base44-app-migrated/**'
    ],
  },
});
