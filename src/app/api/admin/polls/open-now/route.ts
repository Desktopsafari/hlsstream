import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getOpenNowInfo, openPollNow } from "@/lib/pollLifecycle";
import {
  createPollWithOptions,
  deletePollWithFiles,
  parseNewOptions,
  parsePendingImage,
} from "@/lib/pollAdmin";
import { isDailyColumns, resolveDuration, type DurationColumns } from "@/lib/pollDuration";

// What the admin sees before confirming "Open now": how long voting would run,
// whether it's allowed at all, and what happens to a poll that is already
// open. ?pollId= is a queued poll; ?duration= (JSON) is the choice made in the
// Set Next Poll form for a poll that doesn't exist yet.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const pollId = params.get("pollId") ?? undefined;
  let duration: DurationColumns | null = null;
  const raw = params.get("duration");
  if (raw) {
    try {
      const now = new Date();
      const resolved = resolveDuration(JSON.parse(raw), now, now);
      if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 400 });
      duration = resolved.columns;
    } catch {
      return NextResponse.json({ error: "Bad duration." }, { status: 400 });
    }
  }
  const supabase = createServiceRoleClient();
  return NextResponse.json(await getOpenNowInfo(supabase, { pollId, duration }));
}

// Opens a poll right now. Body is either { pollId } (a poll waiting in the
// queue) or { question, options, repeatDaily, duration } (a new poll from the
// form), plus confirmReplace: true to close an already-open poll.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const confirmReplace = body?.confirmReplace === true;
  const supabase = createServiceRoleClient();

  let pollId: string | null = typeof body?.pollId === "string" && body.pollId ? body.pollId : null;
  let createdHere = false;

  if (!pollId) {
    const options = parseNewOptions(body?.options);
    const question = body?.question;
    const imagePath = parsePendingImage(body?.imagePath);
    if (typeof question !== "string" || question.trim().length === 0 || !options) {
      return NextResponse.json(
        { error: "Need a question and at least 2 non-empty options." },
        { status: 400 },
      );
    }
    if (imagePath === undefined) {
      return NextResponse.json({ error: "That picture isn't a valid upload." }, { status: 400 });
    }
    const now = new Date();
    const resolved = resolveDuration(body?.duration, now, now);
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: 400 });
    }
    if (body?.repeatDaily === true && !isDailyColumns(resolved.columns)) {
      return NextResponse.json(
        { error: "A multi-day or open-ended poll can't repeat daily." },
        { status: 400 },
      );
    }

    // Refuse before creating anything if it can't go live anyway.
    const info = await getOpenNowInfo(supabase, { duration: resolved.columns });
    if (!info.allowed) {
      return NextResponse.json({ error: info.message, code: "past_cutoff" }, { status: 409 });
    }
    if (info.openPoll && !confirmReplace) {
      return NextResponse.json(
        { error: "A poll is already open. Confirm to close it and open this one instead.", code: "confirm_replace" },
        { status: 409 },
      );
    }

    const created = await createPollWithOptions(supabase, {
      question,
      options,
      repeatDaily: body?.repeatDaily === true,
      imagePath,
      duration: resolved.columns,
    });
    if (!created.ok) {
      return NextResponse.json({ error: created.error }, { status: created.status });
    }
    pollId = created.pollId;
    createdHere = true;
  }

  const result = await openPollNow(supabase, { pollId, confirmReplace });
  if (!result.ok) {
    // A poll made just for this request shouldn't be left behind in the queue.
    if (createdHere) await deletePollWithFiles(supabase, pollId);
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  }
  return NextResponse.json(result);
}
