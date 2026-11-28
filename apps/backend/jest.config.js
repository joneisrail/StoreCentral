const { loadEnv } = require("@medusajs/utils");
loadEnv("test", process.cwd());

module.exports = {
  transform: {
    "^.+\\.[jt]s$": [
      "@swc/jest",
      {
        jsc: {
          parser: { syntax: "typescript", decorators: true },
        },
      },
    ],
    "^.+\\.[jt]sx$": [
      "@swc/jest",
      {
        jsc: {
          parser: { syntax: "typescript", tsx: true, decorators: true },
          transform: { react: { runtime: "automatic" } },
        },
      },
    ],
  },
  testEnvironment: "node",
  moduleFileExtensions: ["js", "ts", "tsx", "json"],
  modulePathIgnorePatterns: ["dist/", "<rootDir>/.medusa/"],
  // Ignore the compiled copy that `medusa build` writes under .medusa. The
  // separator class keeps the pattern working on Windows paths too.
  testPathIgnorePatterns: ["/node_modules/", "[\\/]\\.medusa[\\/]"],
  // `meilisearch` ships ESM only. Compiling it to CommonJS lets the
  // Meilisearch integration spec load the real client; that spec runs without
  // --experimental-vm-modules, which would otherwise refuse to require ESM.
  transformIgnorePatterns: ["[\\/]node_modules[\\/](?!meilisearch[\\/])"],
  setupFiles: ["./integration-tests/setup.js"],
};

if (process.env.TEST_TYPE === "integration:http") {
  module.exports.testMatch = ["**/integration-tests/http/*.spec.[jt]s"];
} else if (process.env.TEST_TYPE === "integration:modules") {
  module.exports.testMatch = ["**/src/modules/*/__tests__/**/*.[jt]s"];
} else if (process.env.TEST_TYPE === "unit") {
  module.exports.testMatch = [
    "**/src/**/__tests__/**/*.unit.spec.[jt]s",
    "**/src/**/__tests__/**/*.unit.spec.tsx",
  ];
}
