import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getOpenNowInfo, openPollNow } from "@/lib/pollLifecycle";
import { createPollWithOptions, deletePollWithFiles, parseNewOptions } from "@/lib/pollAdmin";

// What the admin sees before confirming "Open now": how long voting would run,
// whether it's allowed at all, and what happens to a poll that is already
// open. ?pollId= excludes that queued poll when looking for "another" queued
// poll.
export async function GET(request: Request) {
  const pollId = new URL(request.url).searchParams.get("pollId") ?? undefined;
  const supabase = createServiceRoleClient();
  return NextResponse.json(await getOpenNowInfo(supabase, { pollId }));
}

// Opens a poll right now. Body is either { pollId } (a poll waiting in the
// queue) or { question, options, repeatDaily } (a new poll from the form),
// plus confirmReplace: true to close an already-open poll.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const confirmReplace = body?.confirmReplace === true;
  const supabase = createServiceRoleClient();

  let pollId: string | null = typeof body?.pollId === "string" && body.pollId ? body.pollId : null;
  let createdHere = false;

  if (!pollId) {
    const options = parseNewOptions(body?.options);
    const question = body?.question;
    if (typeof question !== "string" || question.trim().length === 0 || !options) {
      return NextResponse.json(
        { error: "Need a question and at least 2 non-empty options." },
        { status: 400 },
      );
    }

    // Refuse before creating anything if it can't go live anyway.
    const info = await getOpenNowInfo(supabase);
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
