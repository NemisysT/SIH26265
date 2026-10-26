// Injectable clock so date-driven rules are deterministic under test.
let fixed: Date | null = null;

export function now(): Date {
  return fixed ? new Date(fixed) : new Date();
}

export function setClock(date: Date | null) {
  fixed = date;
}
