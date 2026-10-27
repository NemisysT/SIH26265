// Load `.env` for standalone CLI scripts (seed, monitor, launcher helpers). Next.js and the Prisma
// CLI load it themselves; plain `tsx` does not. Variables already set in the environment win.
import path from "node:path";

try {
  process.loadEnvFile(path.resolve(process.cwd(), ".env"));
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
}
