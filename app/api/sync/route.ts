import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import { NextRequest, NextResponse } from "next/server";

// ─── Types ────────────────────────────────────────────────────────────────────
interface DayData {
  status:    "succeed" | "wasted";
  learned:   string;
  did:       string;
  timeLeak:  string;
  updatedAt: number; // unix ms — used to resolve conflicts
  deleted?:  boolean;
}
type MonthData = Record<number, DayData>;
type YearData  = Record<string, MonthData>;

// ─── Clients ──────────────────────────────────────────────────────────────────
const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// ─── Rate limiters ────────────────────────────────────────────────────────────
const readLimiter = new Ratelimit({
  redis,
  limiter:   Ratelimit.slidingWindow(60, "1 m"),
  prefix:    "rl:read",
  analytics: false,
});
const writeLimiter = new Ratelimit({
  redis,
  limiter:   Ratelimit.slidingWindow(30, "1 m"),
  prefix:    "rl:write",
  analytics: false,
});

// ─── Constants ────────────────────────────────────────────────────────────────
const APP_PASSCODE  = (process.env.APP_PASSCODE || "").trim();
const MAX_SYNC_KEYS = parseInt(process.env.MAX_SYNC_KEYS || "5", 10);
const KEY_REGISTRY  = "dsa:registry";
const DATA_PREFIX   = "dsa:data:";
const META_PREFIX   = "dsa:meta:"; // stores last updated timestamp per key

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getIP(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

function isValidKey(k: string): boolean {
  return /^[a-zA-Z0-9._-]{4,60}$/.test(k);
}

function validatePasscode(req: NextRequest): boolean {
  if (!APP_PASSCODE) {
    console.error("APP_PASSCODE not set — all requests blocked.");
    return false;
  }
  const h = (req.headers.get("x-app-passcode") || "").trim();
  const q = (req.nextUrl.searchParams.get("passcode") || "").trim();
  return h === APP_PASSCODE || q === APP_PASSCODE;
}

// Per-day merge: newer updatedAt wins, fallback to cloud if no timestamp
function mergeDayData(
  local: DayData | undefined,
  cloud: DayData | undefined
): DayData | undefined {
  if (!local && !cloud) return undefined;
  if (!local) return cloud;
  if (!cloud) return local;

  const localTs = local.updatedAt || 0;
  const cloudTs = cloud.updatedAt || 0;

  // Newer timestamp always wins — even if it's a deletion
  const winner = cloudTs >= localTs ? cloud : local;

  // If winner is a tombstone → return undefined (erases the day)
  if (winner.deleted) return undefined;

  return winner;
}

// Deep field-level merge of two YearData objects
// Server stores tombstones — NEVER resolves them
// Clients use stripTombstones() for display only
function mergeYearData(base: YearData, incoming: YearData): YearData {
  const result: YearData = { ...base };

  MONTHS.forEach((m) => {
    if (!incoming[m]) return;
    const mergedMonth: MonthData = { ...(result[m] || {}) };

    Object.keys(incoming[m]).forEach((dayStr) => {
      const day      = Number(dayStr);
      const localDay = mergedMonth[day];
      const cloudDay = incoming[m][day];

      if (!localDay && !cloudDay) return;
      if (!localDay) { mergedMonth[day] = cloudDay; return; }
      if (!cloudDay) { mergedMonth[day] = localDay; return; }

      const localTs = localDay.updatedAt || 0;
      const cloudTs = cloudDay.updatedAt || 0;

      // Newer timestamp wins — INCLUDING tombstones
      // Tombstone stays in storage so other devices learn about deletion
      mergedMonth[day] = cloudTs >= localTs ? cloudDay : localDay;
    });

    // Never delete empty months from storage
    // (a month with only tombstones still needs to propagate)
    result[m] = mergedMonth;
  });

  return result;
}

async function checkPreflight(
  req: NextRequest,
  limiter: Ratelimit,
  syncKey: string | null
): Promise<NextResponse | null> {
  if (!validatePasscode(req)) {
    return NextResponse.json({ error: "Wrong app passcode." }, { status: 401 });
  }
  const { success } = await limiter.limit(getIP(req));
  if (!success) {
    return NextResponse.json(
      { error: "Too many requests — wait a minute." },
      { status: 429 }
    );
  }
  if (!syncKey?.trim()) {
    return NextResponse.json({ error: "No sync key provided." }, { status: 400 });
  }
  const clean = syncKey.trim();
  if (clean.length < 4) {
    return NextResponse.json(
      { error: `Key too short: "${clean}" (min 4 chars).` },
      { status: 400 }
    );
  }
  if (!isValidKey(clean)) {
    return NextResponse.json(
      { error: `Invalid key: "${clean}". Use letters, numbers, - _ . only.` },
      { status: 400 }
    );
  }
  return null;
}

// ─── GET — pull data ──────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  // Passcode probe — no key needed
  if (req.nextUrl.searchParams.get("key") === "__probe__") {
    if (!validatePasscode(req)) {
      return NextResponse.json({ error: "Wrong app passcode." }, { status: 401 });
    }
    return NextResponse.json({ ok: true });
  }

  const syncKey = req.nextUrl.searchParams.get("key");
  const fail    = await checkPreflight(req, readLimiter, syncKey);
  if (fail) return fail;

  const clean = syncKey!.trim();

  try {
    const [data, meta] = await Promise.all([
      redis.get<string>(`${DATA_PREFIX}${clean}`),
      redis.get<string>(`${META_PREFIX}${clean}`),
    ]);

    const parsed: YearData = data
      ? (typeof data === "string" ? JSON.parse(data) : data)
      : {};

    return NextResponse.json({
      data:      Object.keys(parsed).length > 0 ? parsed : null,
      updatedAt: meta ? Number(meta) : null,
    });
  } catch (e) {
    console.error("Redis GET error:", e);
    return NextResponse.json({ error: "Redis error." }, { status: 500 });
  }
}

// ─── PATCH — atomic pull → merge → push (conflict-safe write) ─────────────────
export async function PATCH(req: NextRequest) {
  let body: { syncKey?: string; yearData?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const syncKey = (body.syncKey as string) ?? null;
  const fail    = await checkPreflight(req, writeLimiter, syncKey);
  if (fail) return fail;

  const clean = syncKey!.trim();

  if (
    !body.yearData ||
    typeof body.yearData !== "object" ||
    Array.isArray(body.yearData)
  ) {
    return NextResponse.json({ error: "Invalid data." }, { status: 400 });
  }

  const incoming = body.yearData as YearData;

  // Size check
  if (JSON.stringify(incoming).length > 512 * 1024) {
    return NextResponse.json({ error: "Data too large (max 512KB)." }, { status: 413 });
  }

  try {
    // Check / register key
    const isExisting = await redis.sismember(KEY_REGISTRY, clean);
    if (!isExisting) {
      const total = await redis.scard(KEY_REGISTRY);
      if (total >= MAX_SYNC_KEYS) {
        return NextResponse.json(
          { error: `Max ${MAX_SYNC_KEYS} sync keys reached. Ask admin to raise limit.` },
          { status: 403 }
        );
      }
      await redis.sadd(KEY_REGISTRY, clean);
    }

    // Pull current cloud data
    const existing = await redis.get<string>(`${DATA_PREFIX}${clean}`);
    const cloudData: YearData = existing
      ? (typeof existing === "string" ? JSON.parse(existing) : existing)
      : {};

    // Merge: field-level, newer timestamp wins
    const merged = mergeYearData(cloudData, incoming);

    // Store merged result + update timestamp
    const now = Date.now();
    await Promise.all([
      redis.set(`${DATA_PREFIX}${clean}`, JSON.stringify(merged)),
      redis.set(`${META_PREFIX}${clean}`, String(now)),
    ]);

    // Return merged data so client can update itself
    return NextResponse.json({ ok: true, merged, updatedAt: now });
  } catch (e) {
    console.error("Redis PATCH error:", e);
    return NextResponse.json({ error: "Redis error." }, { status: 500 });
  }
}