import { defineConfig } from 'tsup';

// Bundel engine (TypeScript workspace) ke dalam dist server → `node dist/index.js` tanpa tsx.
export default defineConfig({
  entry: ['src/index.ts', 'src/db/migrate.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  noExternal: ['@kuypoker/engine'],
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});
