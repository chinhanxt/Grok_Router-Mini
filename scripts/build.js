import esbuild from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

console.log('📦 Building & obfuscating ai-claude-keyapi backend...');

await esbuild.build({
  entryPoints: [
    path.join(rootDir, 'src/server.js'),
    path.join(rootDir, 'src/utils/updateNotifier.js'),
    path.join(rootDir, 'src/utils/shortcut.js')
  ],
  outdir: distDir,
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  minify: true,
  legalComments: 'none',
  sourcemap: false,
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);"
  },
  external: [
    'node:*'
  ]
});

console.log('✅ Build completed successfully into dist/ (Protected bundle)');
