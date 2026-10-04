import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

type Row = {
  frog_id: string;
  text: string;
  normalized_text: string;
  is_flagged: boolean;
  is_shortlisted: boolean;
  created_at: string;
};

type Group = {
  key: string;
  text: string;
  count: number;
  newestAt: string;
  isFlagged: boolean;
  isShortlisted: boolean;
};

// Name ideas for one event, grouped per frog. Duplicates (same normalized
// text) are merged with a count; sorted by count, then newest.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const eventId = params.get("eventId");
  const includeFlagged = params.get("includeFlagged") === "1";
  if (!eventId) return NextResponse.json({ error: "Missing eventId." }, { status: 400 });

  const supabase = createServiceRoleClient();

  const { data: frogs } = await supabase
    .from("suggestion_event_frogs")
    .select("id, label, display_order")
    .eq("event_id", eventId)
    .order("display_order", { ascending: true });

  // PostgREST returns at most 1000 rows per request, so page through them.
  const rows: Row[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await supabase
      .from("name_suggestions")
      .select("frog_id, text, normalized_text, is_flagged, is_shortlisted, created_at")
      .eq("event_id", eventId)
      .order("created_at", { ascending: false })
      .range(from, from + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  let hiddenFlaggedGroups = 0;
  const result = (frogs ?? []).map((frog) => {
    const byKey = new Map<string, Row[]>();
    for (const r of rows) {
      if (r.frog_id !== frog.id) continue;
      const list = byKey.get(r.normalized_text) ?? [];
      list.push(r);
      byKey.set(r.normalized_text, list);
    }

    const groups: Group[] = [];
    for (const [key, list] of byKey) {
      const isFlagged = list.some((r) => r.is_flagged);
      if (isFlagged && !includeFlagged) {
        hiddenFlaggedGroups++;
        continue;
      }

      // Show the spelling people used most; ties go to the newest (rows are
      // already newest-first).
      const spellings = new Map<string, number>();
      for (const r of list) spellings.set(r.text, (spellings.get(r.text) ?? 0) + 1);
      let text = list[0].text;
      let best = 0;
      for (const [t, n] of spellings) {
        if (n > best) {
          best = n;
          text = t;
        }
      }

      groups.push({
        key,
        text,
        count: list.length,
        newestAt: list[0].created_at,
        isFlagged,
        isShortlisted: list.some((r) => r.is_shortlisted),
      });
    }

    groups.sort(
      (a, b) => b.count - a.count || new Date(b.newestAt).getTime() - new Date(a.newestAt).getTime(),
    );
    return { frogId: frog.id, label: frog.label, groups };
  });

  return NextResponse.json({ frogs: result, hiddenFlaggedGroups });
}

// Shortlist or un-shortlist a name (every merged duplicate at once).
export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  const { eventId, frogId, key } = body ?? {};
  if (
    typeof eventId !== "string" ||
    typeof frogId !== "string" ||
    typeof key !== "string" ||
    typeof body?.shortlisted !== "boolean"
  ) {
    return NextResponse.json({ error: "Missing eventId, frogId, key, or shortlisted." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("name_suggestions")
    .update({ is_shortlisted: body.shortlisted })
    .eq("event_id", eventId)
    .eq("frog_id", frogId)
    .eq("normalized_text", key);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// Delete a name (every merged duplicate of it).
export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null);
  const { eventId, frogId, key } = body ?? {};
  if (typeof eventId !== "string" || typeof frogId !== "string" || typeof key !== "string") {
    return NextResponse.json({ error: "Missing eventId, frogId, or key." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("name_suggestions")
    .delete()
    .eq("event_id", eventId)
    .eq("frog_id", frogId)
    .eq("normalized_text", key);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
