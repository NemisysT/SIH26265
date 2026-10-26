import { execSync } from "node:child_process";

/** Apply migrations to the test database once per run. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://sdp:sdp_local_dev@localhost:5432/sdp_test?schema=public";
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env, DATABASE_URL: url } });
}
