import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import { NextRequest, NextResponse } from "next/server";

// ─── Clients ──────────────────────────────────────────────────────────────────
const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// ─── Rate limiters ────────────────────────────────────────────────────────────
// Read  — 30 requests per minute per IP
const readLimiter = new Ratelimit({
  redis,
  limiter:   Ratelimit.slidingWindow(30, "1 m"),
  prefix:    "ratelimit:read",
  analytics: false,
});

// Write — 20 requests per minute per IP
const writeLimiter = new Ratelimit({
  redis,
  limiter:   Ratelimit.slidingWindow(20, "1 m"),
  prefix:    "ratelimit:write",
  analytics: false,
});

// ─── Constants ────────────────────────────────────────────────────────────────
const APP_PASSCODE  = process.env.APP_PASSCODE  || "";
const MAX_SYNC_KEYS = parseInt(process.env.MAX_SYNC_KEYS || "5", 10);
const KEY_REGISTRY  = "dsa-war-room:__key-registry__"; // Redis set of all known keys
const DATA_PREFIX   = "dsa-war-room:data:";            // actual data lives here

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getIP(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

function isValidKey(k: string): boolean {
  // Only lowercase letters, numbers, hyphens, underscores. 4–40 chars.
  return /^[a-z0-9_-]{4,40}$/.test(k);
}

function validatePasscode(req: NextRequest): boolean {
  // Accept passcode via header OR query param
  const header = req.headers.get("x-app-passcode") || "";
  const query  = req.nextUrl.searchParams.get("passcode") || "";
  return header === APP_PASSCODE || query === APP_PASSCODE;
}

// ─── GET — load data ──────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const ip = getIP(req);

  // 1. Passcode check
  if (!validatePasscode(req)) {
    return NextResponse.json(
      { error: "Unauthorised — wrong app passcode." },
      { status: 401 }
    );
  }

  // 2. Rate limit
  const { success, limit, remaining } = await readLimiter.limit(ip);
  if (!success) {
    return NextResponse.json(
      { error: "Too many requests — slow down." },
      {
        status: 429,
        headers: {
          "X-RateLimit-Limit":     String(limit),
          "X-RateLimit-Remaining": String(remaining),
          "Retry-After":           "60",
        },
      }
    );
  }

  // 3. Validate sync key
  const syncKey = req.nextUrl.searchParams.get("key") || "";
  if (!isValidKey(syncKey)) {
    return NextResponse.json(
      { error: "Invalid key format (4-40 chars, a-z 0-9 - _)" },
      { status: 400 }
    );
  }

  // 4. Fetch data
  const data = await redis.get(`${DATA_PREFIX}${syncKey}`);
  return NextResponse.json({ data: data ?? null });
}

// ─── POST — save data ─────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const ip = getIP(req);

  // 1. Passcode check
  if (!validatePasscode(req)) {
    return NextResponse.json(
      { error: "Unauthorised — wrong app passcode." },
      { status: 401 }
    );
  }

  // 2. Rate limit
  const { success, limit, remaining } = await writeLimiter.limit(ip);
  if (!success) {
    return NextResponse.json(
      { error: "Too many requests — slow down." },
      {
        status: 429,
        headers: {
          "X-RateLimit-Limit":     String(limit),
          "X-RateLimit-Remaining": String(remaining),
          "Retry-After":           "60",
        },
      }
    );
  }

  // 3. Parse body
  let body: { syncKey?: string; yearData?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { syncKey, yearData } = body;

  // 4. Validate sync key format
  if (!syncKey || !isValidKey(syncKey)) {
    return NextResponse.json(
      { error: "Invalid key format (4-40 chars, a-z 0-9 - _)" },
      { status: 400 }
    );
  }

  // 5. Validate data shape
  if (!yearData || typeof yearData !== "object" || Array.isArray(yearData)) {
    return NextResponse.json({ error: "Invalid data shape." }, { status: 400 });
  }

  // 6. Check if this is a NEW key — enforce max key limit
  const isExistingKey = await redis.sismember(KEY_REGISTRY, syncKey);

  if (!isExistingKey) {
    const totalKeys = await redis.scard(KEY_REGISTRY);

    if (totalKeys >= MAX_SYNC_KEYS) {
      return NextResponse.json(
        {
          error: `Max sync keys reached (${MAX_SYNC_KEYS}). Ask admin to raise the limit or delete unused keys.`,
        },
        { status: 403 }
      );
    }

    // Register the new key
    await redis.sadd(KEY_REGISTRY, syncKey);
  }

  // 7. Validate data size — max 512 KB per key
  const serialised = JSON.stringify(yearData);
  if (serialised.length > 512 * 1024) {
    return NextResponse.json(
      { error: "Data too large (max 512 KB)." },
      { status: 413 }
    );
  }

  // 8. Save
  await redis.set(`${DATA_PREFIX}${syncKey}`, serialised);

  return NextResponse.json({ ok: true });
}