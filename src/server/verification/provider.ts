// External verification is isolated behind this interface. No authorised bank verification API is
// integrated. The only implementation is a clearly labelled DEMO / SIMULATED adapter whose results
// are recorded as simulated and can NEVER mark an instrument as confirmed.
import { createHash } from "node:crypto";

export interface ProviderRequest {
  instrumentNumber: string | null;
  bankName: string | null;
  amount: string | null;
  maturityDate: string | null;
}

export interface ProviderResult {
  outcome: "MATCH" | "MISMATCH" | "NOT_FOUND";
  reference: string;
  details: string;
}

export interface VerificationProvider {
  name: string;
  isSimulated: boolean;
  verify(req: ProviderRequest): Promise<ProviderResult>;
}

/** Deterministic simulation for demonstrations. Not connected to any bank. */
export class DemoSimulatedProvider implements VerificationProvider {
  name = "DEMO simulated bank-verification adapter";
  isSimulated = true;
  async verify(req: ProviderRequest): Promise<ProviderResult> {
    const digest = createHash("sha256").update(`${req.bankName}|${req.instrumentNumber}`).digest();
    const bucket = digest[0] % 10;
    const reference = `SIM-${digest.toString("hex").slice(0, 10).toUpperCase()}`;
    if (!req.instrumentNumber || !req.bankName) {
      return { outcome: "NOT_FOUND", reference, details: "SIMULATED: insufficient identifiers to query." };
    }
    if (bucket < 7) return { outcome: "MATCH", reference, details: "SIMULATED: synthetic record matched on number and bank." };
    if (bucket < 9) return { outcome: "MISMATCH", reference, details: "SIMULATED: synthetic record differs in amount or maturity date." };
    return { outcome: "NOT_FOUND", reference, details: "SIMULATED: no synthetic record found." };
  }
}

/** VERIFICATION_PROVIDER=demo enables the simulated adapter; anything else means none configured. */
export function getVerificationProvider(): VerificationProvider | null {
  const configured = process.env.VERIFICATION_PROVIDER ?? (process.env.DEMO_MODE === "true" ? "demo" : "none");
  return configured === "demo" ? new DemoSimulatedProvider() : null;
}
