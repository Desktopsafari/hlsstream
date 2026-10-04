import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { eventImageUrl, getActiveEvent } from "@/lib/events";

// The currently active suggestion event (switched on and not past its end
// time), or { event: null }. Checked against the clock on every request --
// no cron job is involved in switching an event off.
export async function GET() {
  const supabase = createServiceRoleClient();
  const active = await getActiveEvent(supabase);

  const body = active
    ? {
        event: {
          id: active.event.id,
          prompt: active.event.prompt,
          description: active.event.description,
          endsAt: active.event.ends_at,
          frogs: active.frogs.map((f) => ({
            id: f.id,
            label: f.label,
            imageUrl: eventImageUrl(f.image_path),
          })),
        },
      }
    : { event: null };

  return NextResponse.json({ ...body, serverTime: new Date().toISOString() });
}
