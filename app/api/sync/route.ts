import { Redis } from "@upstash/redis";
import { NextRequest, NextResponse } from "next/server";

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// Key prefix so we never collide with other projects
const redisKey = (syncKey: string) => `dsa-war-room:${syncKey.trim().toLowerCase()}`;

// ── GET — load data for a sync key ────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const syncKey = req.nextUrl.searchParams.get("key");

  if (!syncKey || syncKey.length < 4) {
    return NextResponse.json({ error: "Key too short (min 4 chars)" }, { status: 400 });
  }

  const data = await redis.get(redisKey(syncKey));
  return NextResponse.json({ data: data ?? null });
}

// ── POST — save data for a sync key ───────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { syncKey, yearData } = body;

    if (!syncKey || syncKey.length < 4) {
      return NextResponse.json({ error: "Key too short (min 4 chars)" }, { status: 400 });
    }

    if (!yearData || typeof yearData !== "object") {
      return NextResponse.json({ error: "Invalid data" }, { status: 400 });
    }

    // Store forever (no expiry) — it's a personal tracker
    await redis.set(redisKey(syncKey), JSON.stringify(yearData));

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}