/**
 * "Report a problem": a link to a Google Form with its "Technical details"
 * question prefilled, so a report says what the person was looking at without
 * them having to describe it. The person sees the details before submitting.
 */
const FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLSc2jBo2vUZDOqjaD7g3fXc2_e65Jh5wP-KPdRh3apysALqIKw/viewform";
/** The form's "Technical Details" question (from the form's pre-filled link). */
const DETAILS_FIELD = "entry.895402550";

export interface ReportContext {
  /** The page address, which carries the whole view (election, mode, position…). */
  link: string;
  /** The view in words, e.g. "2023, swing, Green, electorate vote". */
  view: string;
  /** The selected polling place, if any. */
  place: string | null;
  userAgent: string;
  /** Window size and pixel ratio, e.g. "1440×900 @2x". */
  screen: string;
  /** When the map data was built (ISO date). */
  dataBuilt: string;
  /** Data files that failed to load. */
  failed: string[];
  /** document.cookie, read for the Clarity session reference only. */
  cookie: string;
}

/**
 * The current Microsoft Clarity session, to find its recording. Clarity keeps
 * it in the `_clsk` cookie as "sessionId^timestamp^page…" (older versions
 * used "|"), and the visitor in `_clck` the same way. Null when Clarity is
 * off or blocked.
 */
export function claritySession(cookie: string): string | null {
  const first = (name: string) => {
    const pair = cookie
      .split(";")
      .map((p) => p.trim())
      .find((p) => p.startsWith(`${name}=`));
    if (!pair) return null;
    let v = pair.slice(name.length + 1);
    try {
      v = decodeURIComponent(v);
    } catch {
      /* not encoded */
    }
    const id = v.split(/[|^]/)[0];
    return /^[a-z0-9]{4,40}$/i.test(id) ? id : null;
  };
  const session = first("_clsk");
  const user = first("_clck");
  if (!session) return null;
  return user ? `${session} (visitor ${user})` : session;
}

export function reportDetails(c: ReportContext): string {
  const lines = [`Link: ${c.link.slice(0, 700)}`, `View: ${c.view}`];
  if (c.place) lines.push(`Place: ${c.place}`);
  lines.push(`Device: ${c.userAgent}; window ${c.screen}`);
  lines.push(`Version: data built ${c.dataBuilt}${c.failed.length ? `; failed to load: ${c.failed.slice(0, 6).join(", ")}` : ""}`);
  const session = claritySession(c.cookie);
  if (session) lines.push(`Session: ${session}`);
  return lines.join("\n");
}

/** The form address with the technical details filled in. */
export function reportUrl(details: string): string {
  return `${FORM_URL}?usp=pp_url&${DETAILS_FIELD}=${encodeURIComponent(details)}`;
}

export const REPORT_FORM_URL = FORM_URL;
