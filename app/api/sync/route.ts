import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import { NextRequest, NextResponse } from "next/server";

// ─── Clients ──────────────────────────────────────────────────────────────────
const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});


// ─── Rate limiters ────────────────────────────────────────────────────────────
const readLimiter = new Ratelimit({
  redis,
  limiter:   Ratelimit.slidingWindow(30, "1 m"),
  prefix:    "ratelimit:read",
  analytics: false,
});

const writeLimiter = new Ratelimit({
  redis,
  limiter:   Ratelimit.slidingWindow(20, "1 m"),
  prefix:    "ratelimit:write",
  analytics: false,
});

// ─── Constants ────────────────────────────────────────────────────────────────
const APP_PASSCODE  = (process.env.APP_PASSCODE || "").trim();
const MAX_SYNC_KEYS = parseInt(process.env.MAX_SYNC_KEYS || "5", 10);
const KEY_REGISTRY  = "dsa-war-room:__registry__";
const DATA_PREFIX   = "dsa-war-room:data:";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getIP(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

// More permissive — allow letters, numbers, hyphens, underscores, dots
// 4 to 60 chars. Sanitised client-side already.
function isValidKey(k: string): boolean {
  return /^[a-zA-Z0-9._-]{4,60}$/.test(k);
}

function validatePasscode(req: NextRequest): boolean {
   if (!APP_PASSCODE) {
    console.error("APP_PASSCODE env var is not set — all requests blocked.");
    return false;
  }
  const fromHeader = (req.headers.get("x-app-passcode") || "").trim();
  const fromQuery  = (req.nextUrl.searchParams.get("passcode") || "").trim();
  return fromHeader === APP_PASSCODE || fromQuery === APP_PASSCODE;
}

// ─── Shared pre-flight checks ─────────────────────────────────────────────────
async function preflight(
  req: NextRequest,
  limiter: Ratelimit,
  syncKey: string | null
): Promise<NextResponse | null> {
  // 1. Passcode
  if (!validatePasscode(req)) {
    return NextResponse.json(
      { error: "Wrong app passcode." },
      { status: 401 }
    );
  }

  // 2. Rate limit
  const ip = getIP(req);
  const { success } = await limiter.limit(ip);
  if (!success) {
    return NextResponse.json(
      { error: "Too many requests — wait a minute." },
      { status: 429 }
    );
  }

  // 3. Key presence
  if (!syncKey || syncKey.trim() === "") {
    return NextResponse.json(
      { error: "No sync key provided." },
      { status: 400 }
    );
  }

  // 4. Key format
  const clean = syncKey.trim();
  if (clean.length < 4) {
    return NextResponse.json(
      { error: `Key too short: "${clean}" (min 4 chars).` },
      { status: 400 }
    );
  }
  if (clean.length > 60) {
    return NextResponse.json(
      { error: "Key too long (max 60 chars)." },
      { status: 400 }
    );
  }
  if (!isValidKey(clean)) {
    return NextResponse.json(
      {
        error: `Invalid key format: "${clean}". Use only letters, numbers, hyphens, underscores, dots.`,
      },
      { status: 400 }
    );
  }

  return null; // all good
}

// ─── GET — load data ──────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const syncKey = req.nextUrl.searchParams.get("key");

  // Special passcode-check probe — just validate passcode, skip key checks
  if (syncKey === "__probe__") {
    if (!validatePasscode(req)) {
      return NextResponse.json({ error: "Wrong app passcode." }, { status: 401 });
    }
    return NextResponse.json({ ok: true, probe: true });
  }

  const fail = await preflight(req, readLimiter, syncKey);
  if (fail) return fail;

  try {
    const data = await redis.get(`${DATA_PREFIX}${syncKey!.trim()}`);
    return NextResponse.json({ data: data ?? null });
  } catch (e) {
    console.error("Redis GET error:", e);
    return NextResponse.json({ error: "Redis error." }, { status: 500 });
  }
}

// ─── POST — save data ─────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // Parse body first
  let body: { syncKey?: string; yearData?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const syncKey = body.syncKey ?? null;
  const fail    = await preflight(req, writeLimiter, syncKey as string | null);
  if (fail) return fail;

  const cleanKey = (syncKey as string).trim();

  // Validate data shape
  if (
    !body.yearData ||
    typeof body.yearData !== "object" ||
    Array.isArray(body.yearData)
  ) {
    return NextResponse.json({ error: "Invalid data shape." }, { status: 400 });
  }

  // Size limit — 512 KB
  const serialised = JSON.stringify(body.yearData);
  if (serialised.length > 512 * 1024) {
    return NextResponse.json(
      { error: "Data too large (max 512 KB)." },
      { status: 413 }
    );
  }

  try {
    // Check key registry
    const isExisting = await redis.sismember(KEY_REGISTRY, cleanKey);
    if (!isExisting) {
      const total = await redis.scard(KEY_REGISTRY);
      if (total >= MAX_SYNC_KEYS) {
        return NextResponse.json(
          {
            error: `Max ${MAX_SYNC_KEYS} sync keys allowed. Ask admin to raise limit.`,
          },
          { status: 403 }
        );
      }
      await redis.sadd(KEY_REGISTRY, cleanKey);
    }

    await redis.set(`${DATA_PREFIX}${cleanKey}`, serialised);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Redis SET error:", e);
    return NextResponse.json({ error: "Redis error." }, { status: 500 });
  }
}