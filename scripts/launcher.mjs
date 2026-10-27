#!/usr/bin/env node
// One-command local launcher shared by ./run.sh (macOS/Linux) and .\run.ps1 (Windows).
// Plain Node.js with no dependencies, because it runs before `npm ci`.
//
//   start (default)  first-run .env → database (Docker or local) → npm ci if needed → prisma generate
//                    → migrate deploy → demo seed only if the database is empty → one monitor pass
//                    → `next dev` → health check → open browser. Ctrl+C stops the app (not the database).
//   check            report prerequisites and configuration; changes nothing
//   test             unit + integration tests (uses TEST_DATABASE_URL)
//   e2e              Playwright end-to-end tests (RESEEDS the configured database; asks first)
//   monitor          run one maturity/escalation monitor pass
//   reset-demo       DELETE and recreate demonstration data (asks first; refuses if real accounts exist)
//
// Never destructive during `start`: no `migrate reset`, no TRUNCATE, no volume removal, no killing of
// processes this launcher did not start.
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IS_WIN = process.platform === "win32";
const ENV_FILE = path.join(ROOT, ".env");
const ENV_EXAMPLE = path.join(ROOT, ".env.example");
const COMPOSE_FILE = path.join(ROOT, "docker-compose.yml");
const MARKER = path.join(ROOT, "node_modules", ".sdp-launcher.json");
const MIN_NODE = [20, 18];
const DEFAULT_DEMO_PASSWORD = "Demo@SDP2026"; // documented local-only default (README)
const HEALTH_APP_ID = "sdp-portal";
const BIN = {
  next: path.join(ROOT, "node_modules", "next", "dist", "bin", "next"),
  prisma: path.join(ROOT, "node_modules", "prisma", "build", "index.js"),
  tsx: path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"),
  playwright: path.join(ROOT, "node_modules", "@playwright", "test", "cli.js"),
  vitest: path.join(ROOT, "node_modules", "vitest", "vitest.mjs"),
};

// ---------------------------------------------------------------- output helpers
const color = (code) => (s) => (process.stdout.isTTY && !process.env.NO_COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = color("1"), green = color("32"), yellow = color("33"), red = color("31"), dim = color("2");
const step = (msg) => console.log(`${bold("›")} ${msg}`);
const ok = (msg) => console.log(`  ${green("✔")} ${msg}`);
const warn = (msg) => console.log(`  ${yellow("!")} ${msg}`);

class LaunchError extends Error {
  constructor(message, hint) {
    super(message);
    this.hint = hint;
  }
}
const fail = (message, hint) => {
  throw new LaunchError(message, hint);
};

// ---------------------------------------------------------------- process helpers
/** Run a command synchronously. `node:` prefix means "run this JS file with the current Node". */
function run(cmd, args, { capture = false, env = childEnv(), allowFail = false, input } = {}) {
  const isNodeScript = cmd.startsWith("node:");
  const file = isNodeScript ? process.execPath : cmd;
  const argv = isNodeScript ? [cmd.slice(5), ...args] : args;
  // npm/npx are .cmd shims on Windows and need a shell; everything else is spawned directly.
  const shell = IS_WIN && !isNodeScript && /^(npm|npx)$/.test(cmd);
  const res = spawnSync(file, argv, {
    cwd: ROOT,
    env,
    shell,
    input,
    encoding: "utf8",
    stdio: capture ? ["pipe", "pipe", "pipe"] : ["inherit", "inherit", "inherit"],
    windowsHide: true,
  });
  if (res.error && !allowFail) {
    if (res.error.code === "ENOENT") fail(`Command not found: ${cmd}`);
    throw res.error;
  }
  return { code: res.status ?? (res.error ? 127 : 1), stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function commandExists(cmd) {
  const res = spawnSync(IS_WIN ? "where" : "sh", IS_WIN ? [cmd] : ["-c", `command -v "${cmd}"`], { stdio: "ignore", windowsHide: true });
  return res.status === 0;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- .env handling
function parseEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    out[m[1]] = v;
  }
  return out;
}

let dotenv = {};
/** Effective configuration: values already in the environment win over .env (same as Next/Prisma). */
const cfg = (key, fallback) => process.env[key] ?? dotenv[key] ?? fallback;
const childEnv = () => ({ ...dotenv, ...process.env });

function setEnvValues(text, values) {
  let out = text;
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}="${value}"`;
    const re = new RegExp(`^${key}=.*$`, "m");
    out = re.test(out) ? out.replace(re, line) : `${out.trimEnd()}\n${line}\n`;
  }
  return out;
}

let dockerStatus = null;
/** Whether Docker (CLI, running daemon, compose plugin) is usable; checked once per launcher run. */
function dockerUsable() {
  dockerStatus ??= probeDocker();
  return dockerStatus;
}

function probeDocker() {
  if (!commandExists("docker")) return { ok: false, reason: "not-installed" };
  if (run("docker", ["info", "--format", "{{.ServerVersion}}"], { capture: true, allowFail: true }).code !== 0) return { ok: false, reason: "daemon-down" };
  if (run("docker", ["compose", "version"], { capture: true, allowFail: true }).code !== 0) return { ok: false, reason: "no-compose" };
  return { ok: true };
}

/** First run only: create .env from .env.example with safe local-development values. */
function createEnvFile() {
  if (!fs.existsSync(ENV_EXAMPLE)) fail(".env.example is missing; cannot create .env.", "Restore it from version control (git checkout -- .env.example).");
  const requested = process.env.SDP_DB_MODE;
  if (requested && !["docker", "local"].includes(requested)) fail(`SDP_DB_MODE must be "docker" or "local" (got "${requested}").`);
  const docker = dockerUsable();
  const mode = requested ?? (docker.ok ? "docker" : "local");
  const port = process.env.PORT ?? "3000";
  const dbPort = process.env.SDP_DB_PORT ?? (mode === "docker" ? "5433" : "5432");
  const dbUser = "sdp";
  const dbPassword = randomBytes(18).toString("hex"); // URL-safe
  const host = mode === "docker" ? "127.0.0.1" : "localhost";
  const values = {
    SDP_DB_MODE: mode,
    SDP_DB_USER: dbUser,
    SDP_DB_PASSWORD: dbPassword,
    SDP_DB_NAME: "sdp_dev",
    SDP_DB_PORT: dbPort,
    PORT: port,
    DATABASE_URL: process.env.DATABASE_URL ?? `postgresql://${dbUser}:${dbPassword}@${host}:${dbPort}/sdp_dev?schema=public`,
    TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? `postgresql://${dbUser}:${dbPassword}@${host}:${dbPort}/sdp_test?schema=public`,
    APP_URL: `http://localhost:${port}`,
    // Local development only — this .env is created for this machine by the launcher.
    DEMO_MODE: "true",
    DEMO_PASSWORD: DEFAULT_DEMO_PASSWORD,
    VERIFICATION_PROVIDER: "demo",
  };
  const text = setEnvValues(fs.readFileSync(ENV_EXAMPLE, "utf8"), values);
  const header = `# Created by the local launcher on ${new Date().toISOString()} for LOCAL DEVELOPMENT ONLY.\n# It is never overwritten by the launcher. Do not commit it.\n`;
  try {
    fs.writeFileSync(ENV_FILE, header + text, { flag: "wx", mode: 0o600 }); // wx: never overwrite
  } catch (err) {
    if (err.code === "EEXIST") return { created: false };
    throw err;
  }
  return { created: true, mode, docker, dbPassword, usedProvidedUrl: Boolean(process.env.DATABASE_URL) };
}

function describeDbUrl(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || "5432"}/${u.pathname.replace(/^\//, "")} (user ${decodeURIComponent(u.username)})`;
  } catch {
    return "(invalid DATABASE_URL)";
  }
}

// ---------------------------------------------------------------- checks
function checkNode() {
  const [maj, min] = process.versions.node.split(".").map(Number);
  if (maj < MIN_NODE[0] || (maj === MIN_NODE[0] && min < MIN_NODE[1])) {
    fail(`Node.js ${process.versions.node} is too old; ${MIN_NODE.join(".")} or newer is required.`, "Install the current LTS from https://nodejs.org (or `nvm install --lts`).");
  }
  return process.versions.node;
}

function checkNpm() {
  const res = run("npm", ["--version"], { capture: true, allowFail: true });
  if (res.code !== 0) fail("npm was not found.", "npm ships with Node.js; reinstall Node.js from https://nodejs.org.");
  if (!fs.existsSync(path.join(ROOT, "package-lock.json"))) fail("package-lock.json is missing.", "Restore it from version control; the launcher installs exactly the locked versions with `npm ci`.");
  return res.stdout.trim();
}

function refuseProduction() {
  if (cfg("NODE_ENV") === "production") {
    fail(
      "NODE_ENV=production is set. This launcher is for local development and enables demo features.",
      "For production use `npm run build && npm run start` with production configuration (see README › Deployment).",
    );
  }
}

function sha256File(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function readMarker() {
  try {
    return JSON.parse(fs.readFileSync(MARKER, "utf8"));
  } catch {
    return {};
  }
}

function writeMarker(update) {
  fs.mkdirSync(path.dirname(MARKER), { recursive: true });
  fs.writeFileSync(MARKER, JSON.stringify({ ...readMarker(), ...update }, null, 2));
}

// ---------------------------------------------------------------- dependencies & prisma
function ensureDependencies() {
  const lockHash = sha256File(path.join(ROOT, "package-lock.json"));
  const marker = readMarker();
  const installed = Object.values(BIN).slice(0, 3).every((f) => fs.existsSync(f));
  if (installed && marker.lockHash === lockHash && marker.nodeMajor === process.versions.node.split(".")[0]) {
    ok("Dependencies up to date");
    return;
  }
  step("Installing dependencies from package-lock.json (npm ci) — first run or lockfile changed…");
  const res = run("npm", ["ci", "--no-audit", "--no-fund"]);
  if (res.code !== 0) fail("`npm ci` failed.", "Check your network/proxy settings and the npm output above, then re-run.");
  writeMarker({ lockHash, nodeMajor: process.versions.node.split(".")[0], schemaHash: null });
  ok("Dependencies installed");
}

function ensurePrismaClient() {
  const schemaHash = sha256File(path.join(ROOT, "prisma", "schema.prisma"));
  const generated = fs.existsSync(path.join(ROOT, "node_modules", ".prisma", "client", "index.js"));
  if (generated && readMarker().schemaHash === schemaHash) {
    ok("Prisma client up to date");
    return;
  }
  const res = run("node:" + BIN.prisma, ["generate"], { capture: true });
  if (res.code !== 0) {
    process.stderr.write(res.stdout + res.stderr);
    fail("`prisma generate` failed.");
  }
  writeMarker({ schemaHash });
  ok("Prisma client generated");
}

// ---------------------------------------------------------------- database
function compose(args, opts) {
  return run("docker", ["compose", "--project-directory", ROOT, "-f", COMPOSE_FILE, "--env-file", ENV_FILE, ...args], opts);
}

function startDockerDb() {
  const docker = dockerUsable();
  if (!docker.ok) {
    const hints = {
      "not-installed": "Install Docker Desktop (https://docs.docker.com/get-docker/) and start it, or use an existing PostgreSQL 16 by setting SDP_DB_MODE=\"local\" and DATABASE_URL in .env.",
      "daemon-down": "Start Docker Desktop (or the Docker service) and re-run, or set SDP_DB_MODE=\"local\" in .env to use an existing PostgreSQL.",
      "no-compose": "Update Docker to a version that includes `docker compose` (Compose v2), or set SDP_DB_MODE=\"local\" in .env.",
    };
    fail(`Docker is required for SDP_DB_MODE="docker" but is ${docker.reason === "not-installed" ? "not installed" : docker.reason === "daemon-down" ? "not running" : "missing the compose plugin"}.`, hints[docker.reason]);
  }
  if (!cfg("SDP_DB_PASSWORD")) fail("SDP_DB_PASSWORD is not set in .env (required for the Docker database).", "Add SDP_DB_PASSWORD to .env, matching the password in DATABASE_URL.");
  const res = compose(["up", "-d", "db"], { capture: true, allowFail: true });
  if (res.code !== 0) {
    process.stderr.write(res.stdout + res.stderr);
    const portClash = /port is already allocated|address already in use/i.test(res.stderr);
    fail(
      "Could not start the PostgreSQL container.",
      portClash
        ? `Host port ${cfg("SDP_DB_PORT", "5433")} is in use. Change SDP_DB_PORT and the port in DATABASE_URL/TEST_DATABASE_URL in .env, then re-run.`
        : "See the Docker output above.",
    );
  }
  ok(`PostgreSQL container started or reused (127.0.0.1:${cfg("SDP_DB_PORT", "5433")}, volume sdp26265_pgdata)`);
}

async function waitForDockerHealth(timeoutMs = 120_000) {
  const id = compose(["ps", "-q", "db"], { capture: true }).stdout.trim();
  if (!id) fail("The database container is not running.", "Run `docker compose logs db` to see why it stopped.");
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    last = run("docker", ["inspect", "--format", "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}", id], { capture: true, allowFail: true }).stdout.trim();
    if (last === "healthy") return ok("PostgreSQL is accepting connections (container health check)");
    if (last === "unhealthy" || last === "exited" || last === "dead") break;
    await sleep(1500);
  }
  const logs = compose(["logs", "--tail", "30", "db"], { capture: true, allowFail: true });
  process.stderr.write(logs.stdout + logs.stderr);
  fail(`PostgreSQL did not become healthy (last status: ${last || "unknown"}).`, "See the container log above.");
}

/** Real connection test through Prisma using DATABASE_URL (retries briefly for slow starts). */
async function checkDbConnection(mode) {
  const target = describeDbUrl(cfg("DATABASE_URL", ""));
  let res;
  for (let attempt = 1; attempt <= 5; attempt++) {
    res = run("node:" + BIN.tsx, ["scripts/db-check.ts"], { capture: true, allowFail: true });
    if (res.code === 0 || res.code === 4 || res.code === 3 || res.code === 1) break;
    await sleep(2000);
  }
  const message = (res.stdout + res.stderr).trim().split("\n").pop();
  if (res.code === 0) return ok(message);
  if (res.code === 4) return ok(message);
  if (res.code === 3) {
    fail(
      `PostgreSQL rejected the credentials in DATABASE_URL (${target}).`,
      mode === "docker"
        ? "The Docker volume keeps the password it was first created with. Restore the original SDP_DB_PASSWORD/DATABASE_URL in .env. (Deleting the volume would delete the database, so the launcher never does it.)"
        : "Fix the user/password in DATABASE_URL in .env, or create that role in your PostgreSQL server.",
    );
  }
  if (res.code === 2) {
    fail(
      `Cannot reach PostgreSQL at ${target}.`,
      mode === "docker"
        ? "The container is healthy but DATABASE_URL does not point at it. Make the host/port in DATABASE_URL match 127.0.0.1:SDP_DB_PORT in .env."
        : "Start your local PostgreSQL server (or set SDP_DB_MODE=\"docker\" in .env to use Docker), and check host/port in DATABASE_URL.",
    );
  }
  fail(`Database check failed: ${message}`, "Check DATABASE_URL in .env.");
}

async function prepareDatabase() {
  const mode = cfg("SDP_DB_MODE", "local");
  if (!["docker", "local"].includes(mode)) fail(`SDP_DB_MODE in .env must be "docker" or "local" (found "${mode}").`);
  const url = cfg("DATABASE_URL");
  if (!url || !/^postgres(ql)?:\/\//.test(url)) fail("DATABASE_URL in .env is missing or is not a postgresql:// URL.", "See .env.example for the expected format.");
  step(`Database (${mode === "docker" ? "Docker container" : "existing local PostgreSQL"}: ${describeDbUrl(url)})`);
  if (!dotenv.SDP_DB_MODE && !process.env.SDP_DB_MODE) warn('SDP_DB_MODE is not set in .env; using DATABASE_URL as-is ("local" mode).');
  if (mode === "docker") await waitForDockerHealth();
  await checkDbConnection(mode);

  const migrate = run("node:" + BIN.prisma, ["migrate", "deploy"], { capture: true, allowFail: true });
  if (migrate.code !== 0) {
    process.stderr.write(migrate.stdout + migrate.stderr);
    fail("Applying database migrations failed; startup stopped before the app could use an inconsistent schema.", "Read the Prisma error above. Migrations are never reset automatically.");
  }
  const applied = (migrate.stdout.match(/Applying migration/g) ?? []).length;
  ok(applied ? `Applied ${applied} pending migration(s)` : "Database schema up to date (no pending migrations)");
}

async function seedIfEmpty() {
  step("Checking for existing data (demo data is loaded only into an empty database)…");
  const res = run("node:" + BIN.tsx, ["prisma/seed.ts", "--if-empty"], { capture: true, allowFail: true });
  const lines = (res.stdout + res.stderr).split(/\r?\n/).filter((l) => l && !l.startsWith("[email:SIMULATED]"));
  if (res.code !== 0) {
    console.error(lines.join("\n"));
    fail("Loading demonstration data failed.", "Fix the error above, then run the launcher with `reset-demo` to rebuild demo data cleanly.");
  }
  const seeded = lines.some((l) => l.startsWith("Seed complete"));
  for (const l of lines) if (/^(Existing data found|Note:|Seed complete|Seeding)/.test(l)) (l.startsWith("Note:") ? warn : ok)(l.replace(/^Seed complete:.*$/, "Demonstration data loaded (fictional institutions, instruments and accounts)"));
  return seeded;
}

function runMonitorOnce() {
  const res = run("node:" + BIN.tsx, ["scripts/run-monitor.ts"], { capture: true, allowFail: true });
  const line = (res.stdout + res.stderr).split(/\r?\n/).find((l) => l.startsWith("[monitor]"));
  if (res.code !== 0) warn(`Maturity monitor pass failed (the app will still start): ${line ?? "see `npm run monitor`"}`);
  else ok("Maturity / escalation monitor pass completed (reminders are idempotent)");
}

// ---------------------------------------------------------------- application
async function probeHealth(port) {
  for (const host of ["127.0.0.1", "localhost"]) {
    try {
      const res = await fetch(`http://${host}:${port}/api/health`, { signal: AbortSignal.timeout(4000), redirect: "manual" });
      const body = await res.json().catch(() => null);
      if (body && body.app === HEALTH_APP_ID) return { ours: true, healthy: res.ok && body.status === "ok", status: body.status };
      return { ours: false };
    } catch {
      /* try next host */
    }
  }
  return null;
}

function portInUse(port) {
  const tryHost = (host) =>
    new Promise((resolve) => {
      const sock = net.connect({ host, port: Number(port) });
      sock.setTimeout(1500);
      sock.once("connect", () => (sock.destroy(), resolve(true)));
      sock.once("timeout", () => (sock.destroy(), resolve(false)));
      sock.once("error", () => resolve(false));
    });
  return Promise.all([tryHost("127.0.0.1"), tryHost("::1")]).then((r) => r.some(Boolean));
}

function openBrowser(url) {
  if (cfg("SDP_OPEN_BROWSER", "true").toLowerCase() === "false" || process.env.CI) return false;
  const candidates = IS_WIN
    ? [["rundll32", ["url.dll,FileProtocolHandler", url]]]
    : process.platform === "darwin"
      ? [["open", [url]]]
      : (process.env.DISPLAY || process.env.WAYLAND_DISPLAY || process.env.WSL_DISTRO_NAME)
        ? [["wslview", [url]], ["xdg-open", [url]], ["gio", ["open", url]], ["sensible-browser", [url]]]
        : [];
  for (const [cmd, args] of candidates) {
    if (!IS_WIN && !commandExists(cmd)) continue;
    try {
      const child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true });
      child.on("error", () => {});
      child.unref();
      return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

function killTree(child, signal = "SIGTERM") {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (IS_WIN) {
    // Only the tree rooted at the process this launcher started.
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
    try {
      process.kill(-child.pid, signal); // the app runs in its own process group (detached)
    } catch {
      /* already gone */
    }
  }
}

async function startApp(port) {
  const url = `http://localhost:${port}`;
  step(`Starting the portal (next dev on ${cfg("SDP_HOST", "127.0.0.1")}:${port})…`);
  // Bind to loopback by default: demo mode uses a documented password, so the dev server should not
  // be reachable from the local network unless SDP_HOST is set deliberately (e.g. 0.0.0.0).
  const host = cfg("SDP_HOST", "127.0.0.1");
  const child = spawn(process.execPath, [BIN.next, "dev", "-p", String(port), "-H", host], {
    cwd: ROOT,
    env: { ...childEnv(), PORT: String(port) },
    stdio: ["ignore", "inherit", "inherit"],
    detached: !IS_WIN, // own process group on POSIX so Ctrl+C cleanup reaches every child process
    windowsHide: false,
  });

  let stopping = false;
  const stop = async (reason, code) => {
    if (stopping) return;
    stopping = true;
    console.log(`\n${bold("›")} ${reason} — stopping the portal (the database keeps running)…`);
    killTree(child, "SIGTERM");
    const exited = await Promise.race([new Promise((r) => child.once("exit", () => r(true))), sleep(10_000).then(() => false)]);
    if (!exited) killTree(child, "SIGKILL");
    console.log(`  ${green("✔")} Stopped.`);
    process.exit(code);
  };
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => void stop(sig === "SIGINT" ? "Ctrl+C received" : `${sig} received`, 130));
  process.on("exit", () => killTree(child, "SIGKILL")); // last resort, e.g. an unexpected error

  const exitPromise = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  // Wait for THIS app's health endpoint (identified by its app id), not merely an open port.
  const deadline = Date.now() + 240_000;
  let ready = false;
  while (Date.now() < deadline) {
    const exited = await Promise.race([exitPromise, sleep(1500).then(() => null)]);
    if (exited) {
      fail(`The portal process exited during startup (code ${exited.code ?? exited.signal}).`, "See the Next.js output above.");
    }
    const health = await probeHealth(port);
    if (health?.ours && health.healthy) {
      ready = true;
      break;
    }
    if (health?.ours && health.status === "degraded") warn("The app is up but reports the database as unreachable; retrying…");
  }
  if (!ready) {
    killTree(child, "SIGTERM");
    fail("The portal did not become ready within 4 minutes.", "See the Next.js output above.");
  }
  // Warm the sign-in page so the first browser load is fast (dev mode compiles on demand).
  await fetch(`http://127.0.0.1:${port}/login`, { signal: AbortSignal.timeout(120_000) }).catch(() => {});

  const opened = openBrowser(url);
  printReady(url, opened);
  const { code, signal } = await exitPromise;
  if (!stopping) {
    console.error(red(`\nThe portal stopped unexpectedly (code ${code ?? signal}).`));
    process.exit(code ?? 1);
  }
}

function printReady(url, opened) {
  const demo = cfg("DEMO_MODE", "false").toLowerCase() === "true";
  console.log("");
  console.log(green(bold("  Security Deposit & FDR Portal is running")));
  console.log(`  URL:       ${bold(url)}${opened ? dim("  (opened in your browser)") : ""}`);
  console.log(`  Database:  ${cfg("SDP_DB_MODE", "local") === "docker" ? "Docker container (keeps running after Ctrl+C)" : "local PostgreSQL"} · ${describeDbUrl(cfg("DATABASE_URL", ""))}`);
  console.log(`  Documents: ${path.resolve(ROOT, cfg("STORAGE_DIR", "./storage/documents"))}`);
  if (demo) console.log(`  Demo:      sign in with a sample account from the sign-in page; password = DEMO_PASSWORD in .env`);
  console.log(`  Stop:      press ${bold("Ctrl+C")}`);
  console.log("");
}

// ---------------------------------------------------------------- commands
function loadConfig({ allowCreate }) {
  if (!fs.existsSync(ENV_FILE)) {
    if (!allowCreate) fail(".env does not exist yet.", "Run the launcher without arguments once to create it.");
    step("First run: creating .env from .env.example (local development settings)…");
    const created = createEnvFile();
    if (created.created) {
      ok(`.env created (database mode: ${created.mode}; DEMO_MODE=true for local use only)`);
      if (created.mode === "local" && !created.usedProvidedUrl) {
        const why = created.docker.reason === "not-installed" ? "Docker is not installed" : created.docker.reason === "daemon-down" ? "Docker is not running" : "Docker Compose is unavailable";
        warn(`${why}, so .env is configured for an existing local PostgreSQL at localhost:5432.`);
        dotenv = parseEnvFile(ENV_FILE);
        return { firstRunLocal: true, dbPassword: created.dbPassword };
      }
    }
  }
  dotenv = parseEnvFile(ENV_FILE);
  return {};
}

function printLocalDbSetup(dbPassword) {
  console.log(`
  To use your own PostgreSQL 16 (one-time setup, run as a PostgreSQL superuser), e.g.:
      psql -U postgres -c "CREATE ROLE sdp LOGIN CREATEDB PASSWORD '${dbPassword}';"
  The launcher creates the sdp_dev database automatically. This generated password is stored in
  .env (SDP_DB_PASSWORD / DATABASE_URL) and is shown only on this first run.
  Alternatively start Docker and set SDP_DB_MODE="docker" (and the 127.0.0.1:5433 URLs) in .env,
  or delete .env and re-run with Docker running.`);
}

async function cmdStart() {
  console.log(bold("\nSecurity Deposit & FDR Portal — local launcher\n"));
  step("Checking prerequisites…");
  ok(`Node.js ${checkNode()}`);
  ok(`npm ${checkNpm()}`);
  const first = loadConfig({ allowCreate: true });
  refuseProduction();
  const port = cfg("PORT", "3000");
  if (!/^\d{2,5}$/.test(port)) fail(`PORT must be a number (found "${port}").`);
  const appUrl = cfg("APP_URL");
  if (appUrl && !appUrl.includes(`:${port}`)) warn(`APP_URL (${appUrl}) does not use PORT ${port}; update APP_URL in .env to match.`);

  // Already running? Reuse it instead of starting a second server.
  const existing = await probeHealth(port);
  if (existing?.ours) {
    ok(`The portal is already running on port ${port}; not starting a second copy.`);
    const opened = openBrowser(`http://localhost:${port}`);
    console.log(`\n  URL: ${bold(`http://localhost:${port}`)}${opened ? dim("  (opened in your browser)") : ""}\n  Stop it from the terminal where it was started.\n`);
    return;
  }
  if (await portInUse(port)) {
    fail(
      `Port ${port} is already used by another program (it is not this portal), so the portal cannot start.`,
      `Stop that program, or choose another port: set PORT="${Number(port) + 1}" and APP_URL="http://localhost:${Number(port) + 1}" in .env. The launcher never terminates processes it did not start.`,
    );
  }

  const mode = cfg("SDP_DB_MODE", "local");
  if (mode === "docker") {
    step("Starting PostgreSQL (Docker Compose service `db`)…");
    startDockerDb(); // starts in the background while dependencies install
  }
  step("Checking dependencies…");
  ensureDependencies();
  ensurePrismaClient();
  try {
    await prepareDatabase();
  } catch (err) {
    if (first.firstRunLocal && err instanceof LaunchError) {
      printLocalDbSetup(first.dbPassword);
    }
    throw err;
  }
  await seedIfEmpty();
  runMonitorOnce();
  await startApp(port);
}

async function confirm(question, expected) {
  if (process.argv.includes("--yes")) return true;
  if (!process.stdin.isTTY) fail("Confirmation required but no interactive terminal is available.", "Re-run with --yes if you are sure.");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((r) => rl.question(question, r));
  rl.close();
  return answer.trim() === expected;
}

async function ensureReadyForTask() {
  checkNode();
  checkNpm();
  loadConfig({ allowCreate: false });
  refuseProduction();
  if (cfg("SDP_DB_MODE", "local") === "docker") startDockerDb();
  ensureDependencies();
  ensurePrismaClient();
  await prepareDatabase();
}

async function cmdResetDemo() {
  console.log(bold("\nReset demonstration data\n"));
  console.log(yellow("  This DELETES all records and uploaded documents in the configured database and storage folder,"));
  console.log(yellow("  then loads fresh demonstration data. It refuses to run if non-demo user accounts exist."));
  if (!(await confirm('  Type RESET to continue: ', "RESET"))) return console.log("  Cancelled; nothing was changed.");
  await ensureReadyForTask();
  const res = run("node:" + BIN.tsx, ["prisma/seed.ts"], { capture: true, allowFail: true });
  const lines = (res.stdout + res.stderr).split(/\r?\n/).filter((l) => l && !l.startsWith("[email:SIMULATED]"));
  console.log(lines.join("\n"));
  if (res.code !== 0) fail("Reset failed; see the message above.");
  ok("Demonstration data reset.");
}

async function cmdMonitor() {
  await ensureReadyForTask();
  const res = run("node:" + BIN.tsx, ["scripts/run-monitor.ts"]);
  process.exitCode = res.code;
}

async function cmdTest() {
  await ensureReadyForTask();
  if (!cfg("TEST_DATABASE_URL")) warn("TEST_DATABASE_URL is not set in .env; Vitest will use its built-in default.");
  step("Running unit + integration tests (the TEST database is wiped; your app data is not touched)…");
  process.exitCode = run("node:" + BIN.vitest, ["run"]).code;
}

async function cmdE2e() {
  console.log(yellow("\n  End-to-end tests RESEED the database configured in .env (all current records and documents are replaced)."));
  if (!(await confirm("  Type RESET to continue: ", "RESET"))) return console.log("  Cancelled; nothing was changed.");
  await ensureReadyForTask();
  process.exitCode = run("node:" + BIN.playwright, ["test"]).code;
}

async function cmdCheck() {
  console.log(bold("\nPrerequisite check (no changes are made)\n"));
  let problems = 0;
  const bad = (message, hint) => {
    problems++;
    console.log(`  ${red("✘")} ${message}${hint ? `\n    ${dim(hint)}` : ""}`);
  };
  const check = (fn) => {
    try {
      fn();
    } catch (err) {
      bad(err.message, err.hint);
    }
  };
  check(() => ok(`Node.js ${checkNode()}`));
  check(() => ok(`npm ${checkNpm()}`));
  if (fs.existsSync(ENV_FILE)) {
    dotenv = parseEnvFile(ENV_FILE);
    ok(`.env present (database mode: ${cfg("SDP_DB_MODE", "local (not set)")}, DATABASE_URL ${describeDbUrl(cfg("DATABASE_URL", ""))})`);
    check(refuseProduction);
  } else {
    warn(".env not present yet — it will be created on the first start.");
  }
  const docker = dockerUsable();
  const dockerText = docker.reason === "not-installed" ? "not installed" : docker.reason === "daemon-down" ? "installed but not running" : "missing the compose plugin";
  if (docker.ok) ok("Docker and Docker Compose available");
  else if (cfg("SDP_DB_MODE") === "docker") bad(`Docker is ${dockerText}, but SDP_DB_MODE="docker"`, "Start Docker Desktop, or switch to SDP_DB_MODE=\"local\" with an existing PostgreSQL.");
  else warn(`Docker is ${dockerText} (only needed for SDP_DB_MODE="docker")`);
  const installed = fs.existsSync(BIN.next) && fs.existsSync(BIN.tsx);
  if (installed) ok("Dependencies installed");
  else warn("Dependencies not installed yet — `npm ci` runs on the first start.");
  if (installed && fs.existsSync(ENV_FILE)) {
    const res = run("node:" + BIN.tsx, ["scripts/db-check.ts"], { capture: true, allowFail: true });
    const msg = (res.stdout + res.stderr).trim().split("\n").pop();
    if (res.code === 0 || res.code === 4) ok(msg);
    else if (cfg("SDP_DB_MODE") === "docker" && res.code === 2) warn(`${msg} (the launcher starts the Docker database automatically)`);
    else bad(msg);
  }
  const port = cfg("PORT", "3000");
  const health = await probeHealth(port);
  if (health?.ours) ok(`Portal already running on port ${port}`);
  else if (await portInUse(port)) bad(`Port ${port} is used by another program`, "Stop it or change PORT/APP_URL in .env.");
  else ok(`Port ${port} is free`);
  console.log(problems ? red(`\n  ${problems} problem(s) found.\n`) : green("\n  Ready.\n"));
  process.exitCode = problems ? 1 : 0;
}

function usage() {
  const cmd = process.env.SDP_LAUNCHER ?? (IS_WIN ? ".\\run.ps1" : "./run.sh");
  console.log(`Usage: ${cmd} [command]

  (none) | start   Start the database (if Docker mode), prepare it, and run the portal
  check            Check prerequisites and configuration (changes nothing)
  test             Run unit + integration tests
  e2e              Run Playwright end-to-end tests (reseeds the configured database; asks first)
  monitor          Run one maturity / escalation monitor pass
  reset-demo       Delete and recreate demonstration data (asks first)
  help             Show this help

  Add --yes to skip confirmations (reset-demo, e2e).`);
}

// ---------------------------------------------------------------- main
const commands = { start: cmdStart, check: cmdCheck, test: cmdTest, e2e: cmdE2e, monitor: cmdMonitor, "reset-demo": cmdResetDemo };
const name = process.argv.slice(2).find((a) => !a.startsWith("-")) ?? "start";

process.chdir(ROOT);
if (name === "help" || process.argv.includes("--help") || process.argv.includes("-h")) {
  usage();
} else if (!commands[name]) {
  console.error(red(`Unknown command "${name}".`));
  usage();
  process.exitCode = 2;
} else {
  commands[name]().catch((err) => {
    if (err instanceof LaunchError) {
      console.error(`\n${red(bold("✘ " + err.message))}`);
      if (err.hint) console.error(`  ${err.hint}`);
    } else {
      console.error(red(`\n✘ Unexpected launcher error: ${err?.stack ?? err}`));
    }
    process.exit(1);
  });
}
