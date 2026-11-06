import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  createPollWithOptions,
  editPoll,
  hasScheduledPoll,
  listAdminPolls,
  parseNewOptions,
  parsePendingImage,
} from "@/lib/data/polls";
import { isDailyColumns, resolveDuration } from "@/lib/pollDuration";
import { getNextNoon } from "@/lib/pollSchedule";

export async function GET() {
  const result = await listAdminPolls(createServiceRoleClient());
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.body);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const question = body?.question;
  const options = parseNewOptions(body?.options);
  const imagePath = parsePendingImage(body?.imagePath);
  const repeatDaily = body?.repeatDaily === true;

  if (typeof question !== "string" || question.trim().length === 0 || !options) {
    return NextResponse.json(
      { error: "Need a question and at least 2 non-empty options." },
      { status: 400 },
    );
  }
  if (imagePath === undefined) {
    return NextResponse.json({ error: "That picture isn't a valid upload." }, { status: 400 });
  }

  // How long voting runs. Omitted = the normal daily poll, exactly as before.
  const now = new Date();
  const resolved = resolveDuration(body?.duration, getNextNoon(now), now);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: 400 });
  }
  if (repeatDaily && !isDailyColumns(resolved.columns)) {
    return NextResponse.json(
      { error: "A multi-day or open-ended poll can't repeat daily. Turn off Repeat daily or choose Today only." },
      { status: 400 },
    );
  }

  const supabase = createServiceRoleClient();

  if (await hasScheduledPoll(supabase)) {
    return NextResponse.json(
      { error: "There's already a scheduled poll queued up. Wait for it to open, or delete it first." },
      { status: 409 },
    );
  }

  const created = await createPollWithOptions(supabase, {
    question,
    options,
    repeatDaily,
    imagePath,
    duration: resolved.columns,
  });
  if (!created.ok) {
    return NextResponse.json({ error: created.error }, { status: created.status });
  }

  return NextResponse.json({ ok: true, pollId: created.pollId });
}

// Edit a queued or open poll (rules in editPoll, src/lib/data/polls/manage.ts).
export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  const pollId = body?.pollId;
  const question = body?.question;

  if (typeof pollId !== "string" || !pollId) {
    return NextResponse.json({ error: "Missing pollId." }, { status: 400 });
  }
  if (typeof question !== "string" || question.trim().length === 0) {
    return NextResponse.json({ error: "The question can't be empty." }, { status: 400 });
  }

  const result = await editPoll(createServiceRoleClient(), {
    pollId,
    question,
    options: body?.options,
    repeatDaily: body?.repeatDaily,
    duration: body?.duration,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  }
  return NextResponse.json({ ok: true });
}
