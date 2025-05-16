import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client/src',
  build: {
    outDir: '../dist',
    emptyOutDir: true,

    // 1) Prevent Vite from inlining ANY assets as base64.
    //    That way your .jpgs will always be emitted as standalone files.
    assetsInlineLimit: 0
  },

  // 2) Make Vite treat *.jpg as a “real” asset even if it’s
  //    only ever seen inside a Phaser loader call.

  server: {
    proxy: {
      '/socket.io': 'http://localhost:3001'
    }
  }
});