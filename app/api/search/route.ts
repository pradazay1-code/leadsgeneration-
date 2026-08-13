import { NextRequest, NextResponse } from "next/server";
import { searchSymbols } from "@/lib/yahoo";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 1 || q.length > 40) return NextResponse.json({ results: [] });
  const results = await searchSymbols(q);
  return NextResponse.json({ results });
}
