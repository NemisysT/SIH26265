import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Integration tests run against a separate database (TEST_DATABASE_URL, default sdp_test) and are
// executed serially because they share it.
const testDb = process.env.TEST_DATABASE_URL ?? "postgresql://sdp:sdp_local_dev@localhost:5432/sdp_test?schema=public";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    globalSetup: ["tests/setup/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: testDb,
      STORAGE_DIR: path.resolve(__dirname, "storage/test-documents"),
      DEMO_MODE: "false",
      VERIFICATION_PROVIDER: "demo",
      APP_URL: "http://localhost:3000",
    },
  },
});
