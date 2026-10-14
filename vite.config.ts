import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, 'extension/sidepanel/sidepanel.html'),
        options: resolve(__dirname, 'extension/options/options.html'),
        background: resolve(__dirname, 'extension/background/background.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background') {
            return 'background.js';
          }
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
  plugins: [
    {
      name: 'copy-manifest-and-flatten-html',
      closeBundle() {
        const distDir = resolve(__dirname, 'dist');
        if (!existsSync(distDir)) {
          mkdirSync(distDir, { recursive: true });
        }
        copyFileSync(
          resolve(__dirname, 'extension/manifest.json'),
          resolve(distDir, 'manifest.json')
        );

        // Move nested HTML files to dist/sidepanel.html and dist/options.html with adjusted relative asset paths
        const sidepanelSrc = resolve(
          distDir,
          'extension/sidepanel/sidepanel.html'
        );
        if (existsSync(sidepanelSrc)) {
          const html = readFileSync(sidepanelSrc, 'utf-8').replace(
            /\.\.\/\.\.\/assets\//g,
            './assets/'
          );
          writeFileSync(resolve(distDir, 'sidepanel.html'), html, 'utf-8');
        }

        const optionsSrc = resolve(distDir, 'extension/options/options.html');
        if (existsSync(optionsSrc)) {
          const html = readFileSync(optionsSrc, 'utf-8').replace(
            /\.\.\/\.\.\/assets\//g,
            './assets/'
          );
          writeFileSync(resolve(distDir, 'options.html'), html, 'utf-8');
        }
      },
    },
  ],
});
