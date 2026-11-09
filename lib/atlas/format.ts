const intFmt = new Intl.NumberFormat("en-NZ");

export function fmtInt(n: number): string {
  return Number.isFinite(n) ? intFmt.format(Math.round(n)) : "–";
}

/** 0.4567 → "45.7%" (digits adapt for small values). */
export function fmtPct(x: number, digits?: number): string {
  if (!Number.isFinite(x)) return "–";
  const d = digits ?? (Math.abs(x) < 0.01 && x !== 0 ? 2 : 1);
  return `${(x * 100).toFixed(d)}%`;
}

/** Percentage-point difference: 0.051 → "+5.1 pp". */
export function fmtPP(x: number, digits = 1): string {
  if (!Number.isFinite(x)) return "–";
  const v = x * 100;
  const s = v.toFixed(digits);
  return `${v > 0 ? "+" : v < 0 ? "−" : "±"}${s.replace("-", "")} pp`;
}

export function fmtSigned(n: number): string {
  if (!Number.isFinite(n)) return "–";
  return `${n > 0 ? "+" : n < 0 ? "−" : "±"}${intFmt.format(Math.abs(Math.round(n)))}`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("en-NZ", { day: "numeric", month: "long", year: "numeric" });
}
