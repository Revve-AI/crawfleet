import { NextResponse } from "next/server";

const STATUS_MAP: Record<string, number> = {
  Unauthorized: 401,
  Forbidden: 403,
  NotFound: 404,
};

export function apiError(e: unknown): NextResponse {
  const msg = e instanceof Error ? e.message : "Failed";
  const status = STATUS_MAP[msg] || 500;
  return NextResponse.json({ error: msg }, { status });
}
