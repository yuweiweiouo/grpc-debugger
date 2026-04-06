import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';

function extensionScripts() {
  return {
    name: 'build-extension-scripts',
    async writeBundle() {
      const { build } = await import('esbuild');
      const scripts = [
        'background',
        'content-script',
        'devtools',
        'grpc-web-injector',
        'connect-web-interceptor',
      ];
      for (const name of scripts) {
        await build({
          entryPoints: [`src/extension/${name}.ts`],
          bundle: true,
          format: 'iife',
          outfile: `build/${name}.js`,
          target: 'es2020',
          minify: true,
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [svelte(), extensionScripts()],
  build: {
    rollupOptions: {
      input: {
        panel: 'index.html',
      },
      output: {
        entryFileNames: `assets/[name].js`,
        chunkFileNames: `assets/[name].js`,
        assetFileNames: `assets/[name].[ext]`
      }
    },
    outDir: 'build'
  },
  resolve: {
    alias: {
      src: resolve(__dirname, './src'),
    },
  },
});
