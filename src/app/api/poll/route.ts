import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getPublicPollPayload } from "@/lib/data/polls";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");
  return NextResponse.json(await getPublicPollPayload(createServiceRoleClient(), sessionId));
}
