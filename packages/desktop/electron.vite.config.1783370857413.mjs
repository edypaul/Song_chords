// electron.vite.config.ts
import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
var __electron_vite_injected_dirname = "C:\\Users\\Paul\\Documents\\My Files\\Programming\\song_chords\\packages\\desktop";
var sharedSrc = resolve(__electron_vite_injected_dirname, "../../packages/shared/src/index.ts");
var electron_vite_config_default = defineConfig({
  main: {
    // Exclude @song-chords/shared from externalization so the alias bundles it in
    plugins: [externalizeDepsPlugin({ exclude: ["@song-chords/shared"] })],
    build: {
      lib: {
        entry: resolve("electron/main/index.ts")
      }
    },
    resolve: {
      alias: {
        "@song-chords/shared": sharedSrc
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ["@song-chords/shared"] })],
    build: {
      rollupOptions: {
        input: resolve("electron/preload/index.ts")
      }
    },
    resolve: {
      alias: {
        "@song-chords/shared": sharedSrc
      }
    }
  },
  renderer: {
    root: resolve("."),
    plugins: [react()],
    build: {
      rollupOptions: {
        input: resolve("index.html")
      }
    },
    resolve: {
      alias: {
        "@": resolve("src"),
        "@song-chords/shared": sharedSrc
      }
    }
  }
});
export {
  electron_vite_config_default as default
};
