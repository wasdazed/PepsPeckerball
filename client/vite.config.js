export default {
  server: {
    port: 5173,
    open: true,
    hmr: {
      overlay: false // Disable HMR error overlay to reduce noise
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
};

