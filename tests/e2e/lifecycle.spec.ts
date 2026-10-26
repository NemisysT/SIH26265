import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";

const PASSWORD = process.env.DEMO_PASSWORD ?? "Demo@SDP2026";
const here = __dirname;
const pdfPath = path.join(here, ".tmp", "receipt.pdf");

test.beforeAll(() => {
  mkdirSync(path.dirname(pdfPath), { recursive: true });
  const body = "BT /F1 12 Tf 72 720 Td (SYNTHETIC E2E RECEIPT) Tj ET";
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>", `<< /Length ${body.length} >>\nstream\n${body}\nendstream`];
  let out = "%PDF-1.4\n";
  const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  writeFileSync(pdfPath, out, "latin1");
});

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("unauthenticated users are sent to sign-in; the demo picker uses normal password login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText("Demonstration accounts (DEMO_MODE)")).toBeVisible();
  await page.getByRole("button", { name: /Approving Authority/ }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: "Regulation Bureau overview" })).toBeVisible();
  // Authorities do not see officer-only navigation.
  await expect(page.getByRole("link", { name: "Verification Queue" })).toHaveCount(0);
});

test("institution submits an instrument; officer reviews it; history is audited", async ({ browser }) => {
  const number = `E2E${Date.now().toString().slice(-8)}`;
  const inst = await browser.newPage();
  await signIn(inst, "inst.northfield@demo.example.org");
  await inst.getByRole("link", { name: "New submission" }).first().click();

  // Client + server validation: incomplete draft can be saved but not submitted.
  await inst.getByLabel(/Instrument \/ receipt number/).fill(number);
  await inst.getByLabel(/Deposit amount/).fill("1234567.50");
  await inst.getByLabel(/Issuing bank/).fill("Demo National Bank");
  await inst.getByLabel(/^Branch/).fill("Civil Lines");
  await inst.getByLabel(/^Issue date/).fill("2026-10-01");
  await inst.getByLabel(/^Maturity date/).fill("2028-10-01");
  await inst.getByRole("button", { name: "Save draft" }).click();
  await expect(inst.getByText("Draft — not submitted")).toBeVisible();
  const instrumentUrl = inst.url().split("?")[0];

  // Pre-submission check flags the missing receipt.
  await expect(inst.getByText(/Mandatory receipt \/ confirmation document is missing/)).toBeVisible();
  await inst.getByLabel(/^File/).setInputFiles(pdfPath);
  await inst.getByRole("button", { name: "Upload document" }).click();
  await expect(inst.getByText("Uploaded receipt.pdf.")).toBeVisible();
  await expect(inst.getByRole("cell", { name: /FDR \/ deposit receipt/ })).toBeVisible();

  await inst.getByRole("button", { name: "Submit for scrutiny" }).click();
  await inst.getByRole("button", { name: "Confirm: Submit for scrutiny" }).click();
  await expect(inst.getByText("Pending scrutiny").first()).toBeVisible();
  await expect(inst.getByRole("link", { name: "Edit draft" })).toHaveCount(0);

  // Officer for the region picks it up from the verification queue.
  const off = await browser.newPage();
  await signIn(off, "officer.north@demo.example.org");
  await off.goto("/verification?tab=pending");
  await off.getByRole("link", { name: "Review" }).first().waitFor();
  await off.goto(instrumentUrl);
  await expect(off.getByText(number)).toBeVisible();
  await off.getByRole("button", { name: "Start review" }).click();
  await off.getByRole("button", { name: "Confirm: Start review" }).click();
  await expect(off.getByText("Under review").first()).toBeVisible();

  // Manual review cannot be recorded as "Confirmed" under the default policy.
  await off.getByLabel("Result").selectOption("CONFIRMED");
  await expect(off.getByText(/Policy requires independent confirmation/)).toBeVisible();
  await expect(off.getByRole("button", { name: "Record verification" })).toBeDisabled();

  // Request a correction with a reason; the institution sees it.
  await off.getByRole("button", { name: "Request correction" }).click();
  await off.locator("dialog[open]").getByLabel(/Reason \/ observation/).fill("Please upload a clearer copy of the receipt.");
  await off.getByRole("button", { name: "Confirm: Request correction" }).click();
  await expect(off.getByText("Correction required").first()).toBeVisible();

  await inst.reload();
  await expect(inst.getByText("Please upload a clearer copy of the receipt.").first()).toBeVisible();
  await expect(inst.getByText("Correction requested").first()).toBeVisible();
});

test("institution cannot open another institution's record; admins cannot open financial records", async ({ browser }) => {
  const off = await browser.newPage();
  await signIn(off, "officer.south@demo.example.org");
  await off.goto("/instruments?q=DUP");
  const link = off.locator("a[href^='/instruments/']").filter({ hasText: /SDP-/ }).first();
  const href = await link.getAttribute("href");
  expect(href).toBeTruthy();

  const inst = await browser.newPage();
  await signIn(inst, "inst.northfield@demo.example.org");
  await inst.goto(href!);
  await expect(inst.getByRole("heading", { name: "Not found" })).toBeVisible();
  const api = await inst.request.get(`/api/instruments${href!.replace("/instruments", "")}`);
  expect(api.status()).toBe(404);

  const admin = await browser.newPage();
  await signIn(admin, "admin@demo.example.org");
  await admin.goto(href!);
  await expect(admin.getByRole("heading", { name: "Not found" })).toBeVisible();
});

test("API rejects cross-origin state changes and unauthenticated calls", async ({ request }) => {
  const unauth = await request.get("/api/instruments");
  expect(unauth.status()).toBe(401);
  const login = await request.post("/api/auth/login", { data: { email: "officer.north@demo.example.org", password: PASSWORD }, headers: { Origin: "https://evil.example" } });
  expect(login.status()).toBe(403);
  const body = await login.json();
  expect(JSON.stringify(body)).not.toMatch(/stack|at Object\./);
});

test("approving authority approves a forwarded release; completion still requires evidence", async ({ page }) => {
  await signIn(page, "authority@demo.example.org");
  await page.goto("/releases?view=awaiting-me");
  await page.locator("a[href^='/releases/']").filter({ hasText: /REL-/ }).first().click();
  await page.getByRole("button", { name: "Approve" }).click();
  await page.locator("dialog[open]").getByLabel(/Decision reason/).fill("Approved for processing (e2e).");
  await page.getByRole("button", { name: "Confirm: Approve" }).click();
  await expect(page.getByText("Approved — awaiting completion")).toBeVisible();
  await expect(page.getByRole("button", { name: "Record completion" })).toHaveCount(0); // authority cannot complete
});

test("reports export CSV and mobile navigation works", async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await signIn(page, "officer.north@demo.example.org");
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page.locator("#mobile-nav").getByRole("link", { name: "Reports" }).click();
  await expect(page).toHaveURL(/\/reports/);
  const res = await page.request.get("/api/reports/instrument-register");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/csv");
  expect(await res.text()).toContain("Total amount (INR)");
});
