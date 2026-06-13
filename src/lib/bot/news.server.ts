// News-aware circuit-breaker.
// Pulls the weekly economic calendar from the public ForexFactory mirror
// (faireconomy.media) and reports whether we are inside a "blackout window"
// around a high-impact event for a given set of currencies.
//
// The feed is cached in-memory for 1 hour to avoid hammering the source.

export type CalendarEvent = {
  title: string;
  country: string; // currency code e.g. "USD"
  date: string; // ISO timestamp
  impact: string; // "High" | "Medium" | "Low" | "Holiday"
};

type Blackout = {
  active: boolean;
  event?: { title: string; country: string; date: string; minutesUntil: number };
  next?: { title: string; country: string; date: string; minutesUntil: number };
};

const FEED_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const CACHE_TTL_MS = 60 * 60 * 1000;

let cache: { ts: number; events: CalendarEvent[] } | null = null;

async function fetchCalendar(): Promise<CalendarEvent[]> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.events;
  const res = await fetch(FEED_URL, {
    headers: { "user-agent": "lovable-bot/1.0" },
  });
  if (!res.ok) throw new Error(`news feed ${res.status}`);
  const data = (await res.json()) as CalendarEvent[];
  cache = { ts: Date.now(), events: Array.isArray(data) ? data : [] };
  return cache.events;
}

export async function getBlackout(opts: {
  windowMinutes: number;
  currencies: string[]; // e.g. ["USD"]
}): Promise<Blackout> {
  const currencies = new Set(opts.currencies.map((c) => c.toUpperCase()));
  let events: CalendarEvent[];
  try {
    events = await fetchCalendar();
  } catch {
    return { active: false };
  }
  const now = Date.now();
  const win = Math.max(0, opts.windowMinutes) * 60 * 1000;

  const relevant = events.filter(
    (e) =>
      String(e.impact).toLowerCase() === "high" &&
      currencies.has(String(e.country).toUpperCase()),
  );

  let active: Blackout["event"];
  let next: Blackout["next"];
  for (const e of relevant) {
    const t = Date.parse(e.date);
    if (Number.isNaN(t)) continue;
    const delta = t - now;
    if (Math.abs(delta) <= win) {
      const minutesUntil = Math.round(delta / 60000);
      if (!active || Math.abs(minutesUntil) < Math.abs(active.minutesUntil)) {
        active = { title: e.title, country: e.country, date: e.date, minutesUntil };
      }
    } else if (delta > 0) {
      const minutesUntil = Math.round(delta / 60000);
      if (!next || minutesUntil < next.minutesUntil) {
        next = { title: e.title, country: e.country, date: e.date, minutesUntil };
      }
    }
  }

  return { active: !!active, event: active, next };
}
