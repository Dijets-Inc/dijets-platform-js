/** @type {import('jest').Config} */
const base = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/*.test.ts"],
  modulePathIgnorePatterns: ["<rootDir>/dist"],
  transform: { "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.json" }] }
}

module.exports = {
  projects: [
    {
      ...base,
      displayName: "upstream",
      // The vendored upstream suite, run against the vendored code. It mocks
      // axios through test/upstream/__mocks__ and registers a fixture network.
      roots: ["<rootDir>/test/upstream"],
      setupFiles: ["<rootDir>/test/upstream/fixture-network.ts"]
    },
    {
      ...base,
      displayName: "dijets",
      roots: ["<rootDir>/test/dijets"]
    },
    {
      ...base,
      displayName: "integration",
      // Needs a running local devnet; see test/integration/README.md.
      roots: ["<rootDir>/test/integration"],
      setupFiles: ["<rootDir>/test/integration/setup.ts"]
    }
  ]
}
