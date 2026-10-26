// Outbound email is isolated behind this interface. No real email gateway is configured in the
// prototype: the default provider SIMULATES delivery — it records that a message would have been
// sent and never claims real delivery (status SIMULATED, not DELIVERED).

export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

export interface EmailProvider {
  name: string;
  isSimulated: boolean;
  send(message: EmailMessage): Promise<{ providerRef: string }>;
}

export class SimulatedEmailProvider implements EmailProvider {
  name = "simulated-email";
  isSimulated = true;
  async send(message: EmailMessage) {
    // Log metadata only — never message bodies containing financial details.
    if (process.env.NODE_ENV !== "test") {
      console.info(`[email:SIMULATED] to=${message.to.replace(/(.{2}).*(@.*)/, "$1***$2")} subject="${message.subject}"`);
    }
    return { providerRef: `SIMULATED-${Date.now().toString(36)}` };
  }
}

let override: EmailProvider | null = null;

/** Tests may inject a failing provider to exercise retry behaviour. */
export function setEmailProvider(p: EmailProvider | null) {
  override = p;
}

export function getEmailProvider(): EmailProvider {
  return override ?? new SimulatedEmailProvider();
}
