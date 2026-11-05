import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createCapture, parseCaptureInput } from "@/lib/capture";
import { deleteCapture, loadCaptureOverview, updateCapture } from "@/lib/captureAdmin";

// The admin Captures tab (behind the admin login, see proxy.ts): the list
// with usage and disk, capturing (no limits, clips up to 60 s), Feature /
// Keep and Delete.
export async function GET() {
  return NextResponse.json(await loadCaptureOverview(createServiceRoleClient()));
}

export async function POST(request: Request) {
  const input = parseCaptureInput(await request.json().catch(() => null), "admin");
  if (typeof input === "string") return NextResponse.json({ error: input }, { status: 400 });
  const result = await createCapture(createServiceRoleClient(), { ...input, createdBy: "admin" });
  return NextResponse.json(result.body, { status: result.status });
}

export async function PATCH(request: Request) {
  const result = await updateCapture(createServiceRoleClient(), await request.json().catch(() => null));
  return NextResponse.json(result.body, { status: result.status });
}

export async function DELETE(request: Request) {
  const result = await deleteCapture(createServiceRoleClient(), await request.json().catch(() => null));
  return NextResponse.json(result.body, { status: result.status });
}
