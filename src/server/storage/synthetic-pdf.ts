// Minimal, valid single-page PDF generator for demo data and tests. Output is plain text (no
// compression, scripts or embedded files) so it passes upload validation like a real receipt.

/** Escape a PDF literal string; characters outside printable ASCII are replaced. */
function pdfString(s: string) {
  return s.replace(/[^\x20-\x7E]/g, "?").replace(/[\\()]/g, (c) => `\\${c}`);
}

export function syntheticPdf(title: string, lines: string[]): Buffer {
  const text = [
    "BT /F1 16 Tf 72 770 Td",
    `(${pdfString(title)}) Tj`,
    "/F1 11 Tf 0 -28 Td",
    ...lines.map((l) => `(${pdfString(l)}) Tj 0 -16 Td`),
    "0 -12 Td (SYNTHETIC DEMONSTRATION DOCUMENT - NOT A REAL BANK RECORD) Tj",
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(text, "latin1")} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
