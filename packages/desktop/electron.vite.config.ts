import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

const sharedSrc = resolve(__dirname, '../../packages/shared/src/index.ts');

export default defineConfig({
  main: {
    // Exclude @song-chords/shared from externalization so the alias bundles it in
    plugins: [externalizeDepsPlugin({ exclude: ['@song-chords/shared'] })],
    build: {
      lib: {
        entry: resolve('electron/main/index.ts'),
      },
    },
    resolve: {
      alias: {
        '@song-chords/shared': sharedSrc,
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@song-chords/shared'] })],
    build: {
      rollupOptions: {
        input: resolve('electron/preload/index.ts'),
      },
    },
    resolve: {
      alias: {
        '@song-chords/shared': sharedSrc,
      },
    },
  },
  renderer: {
    root: resolve('.'),
    plugins: [react()],
    build: {
      rollupOptions: {
        input: resolve('index.html'),
      },
    },
    resolve: {
      alias: {
        '@': resolve('src'),
        '@song-chords/shared': sharedSrc,
      },
    },
  },
});
