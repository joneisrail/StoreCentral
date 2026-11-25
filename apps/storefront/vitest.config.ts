import path from "path"
import { defineConfig } from "vitest/config"

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    // headless-ui pulls @floating-ui/react and @react-aria from the hoisted
    // root node_modules, which carries React 18. Force a single React copy.
    alias: {
      "@lib": path.resolve(__dirname, "src/lib"),
      "@modules": path.resolve(__dirname, "src/modules"),
      react: path.dirname(require.resolve("react/package.json")),
      "react-dom": path.dirname(require.resolve("react-dom/package.json")),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "*.test.ts"],
    server: {
      deps: {
        inline: [/@headlessui/, /@floating-ui/, /@react-aria/, /@react-stately/, /@tanstack\/react-virtual/],
      },
    },
  },
})
