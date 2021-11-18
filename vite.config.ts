export default {
  root: "./client",
  build: {
    target: "esnext",
  },
  resolve: {
    alias: {
      "rapier3d-node": "@dimforge/rapier3d-compat",
    },
  },
  server: {
    port: 3000,
    https: true,
    proxy: {
      "/ws": {
        target: "wss://localhost:8000",
      },
    },
  },
}
