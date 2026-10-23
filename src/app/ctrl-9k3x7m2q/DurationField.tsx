"use client";

import {
  describeSchedule,
  emailNoteFor,
  endForColumns,
  MAX_POLL_DAYS,
  MIN_POLL_DAYS,
  type DurationColumns,
  type DurationInput,
} from "@/lib/pollDuration";
import { cutoffLabel, getNextNoon, parseEasternDateTime, toEasternDateTimeInput } from "@/lib/pollSchedule";

export type DurationValue = { mode: DurationInput["mode"]; days: string; until: string };

export const DEFAULT_DURATION: DurationValue = { mode: "today", days: "3", until: "" };

export function toDurationInput(v: DurationValue): DurationInput {
  if (v.mode === "days") return { mode: "days", days: Number(v.days) };
  if (v.mode === "until") return { mode: "until", until: v.until };
  return { mode: v.mode } as DurationInput;
}

// What the choice means as stored columns, or null while it's incomplete.
function toColumns(v: DurationValue): DurationColumns | null {
  if (v.mode === "today") return { ends_at: null, open_ended: false, duration_days: null };
  if (v.mode === "open") return { ends_at: null, open_ended: true, duration_days: null };
  if (v.mode === "days") {
    const n = Number(v.days);
    return Number.isInteger(n) && n >= MIN_POLL_DAYS && n <= MAX_POLL_DAYS
      ? { ends_at: null, open_ended: false, duration_days: n }
      : null;
  }
  const end = parseEasternDateTime(v.until);
  return end ? { ends_at: end.toISOString(), open_ended: false, duration_days: null } : null;
}

// Start/end for an existing poll's stored duration, so the editor opens on it.
export function durationValueFromPoll(p: {
  ends_at: string | null;
  open_ended: boolean;
  duration_days: number | null;
}): DurationValue {
  if (p.open_ended) return { ...DEFAULT_DURATION, mode: "open" };
  if (p.duration_days) return { ...DEFAULT_DURATION, mode: "days", days: String(p.duration_days) };
  if (p.ends_at) return { ...DEFAULT_DURATION, mode: "until", until: toEasternDateTimeInput(new Date(p.ends_at)) };
  return DEFAULT_DURATION;
}

const optionClass = "flex flex-wrap items-center gap-2 text-sm text-ink";
const inputClass =
  "rounded-md border border-moss bg-parchment px-2 py-1 text-sm text-ink outline-none focus:border-forest disabled:opacity-50";

// "How long should voting run?" -- shared by Set Next Poll and the editor.
// Multi-day / open-ended polls can't repeat daily, so the long choices are
// disabled while Repeat daily is on (the parent disables the checkbox the
// other way round).
export default function DurationField({
  value,
  onChange,
  repeatDaily,
  supported,
  openNow = false,
}: {
  value: DurationValue;
  onChange: (v: DurationValue) => void;
  repeatDaily: boolean;
  supported: boolean;
  openNow?: boolean;
}) {
  const longDisabled = !supported || repeatDaily;
  const columns = toColumns(value);
  const now = new Date();
  const end = columns ? endForColumns(columns, openNow ? now : getNextNoon(now)) : null;
  const emailNote = columns && columns.ends_at ? emailNoteFor(end) : null;
  const name = "poll-duration";

  const radio = (mode: DurationValue["mode"], label: string, extra?: React.ReactNode, disabled = false) => (
    <div className={optionClass}>
      <label className="flex items-center gap-2">
        <input
          type="radio"
          name={name}
          checked={value.mode === mode}
          disabled={disabled}
          onChange={() => onChange({ ...value, mode })}
          className="h-4 w-4 border-moss"
        />
        <span className={disabled ? "text-muted" : undefined}>{label}</span>
      </label>
      {extra}
    </div>
  );

  return (
    <fieldset className="flex flex-col gap-2 rounded-md border border-moss p-3">
      <legend className="px-1 text-sm font-medium text-ink">How long should voting run?</legend>

      {radio("today", `Today only (normal, ends ${cutoffLabel()})`)}
      {radio(
        "days",
        "Run for",
        <>
          <input
            type="number"
            min={MIN_POLL_DAYS}
            max={MAX_POLL_DAYS}
            value={value.days}
            disabled={longDisabled}
            onChange={(e) => onChange({ ...value, mode: "days", days: e.target.value })}
            aria-label="Number of days"
            className={`${inputClass} w-16`}
          />
          <span className={longDisabled ? "text-muted" : undefined}>
            {`days (ends ${cutoffLabel()} on the last day)`}
          </span>
        </>,
        longDisabled,
      )}
      {radio(
        "until",
        "Until a specific date and time (Eastern Time)",
        <input
          type="datetime-local"
          value={value.until}
          min={toEasternDateTimeInput(now)}
          disabled={longDisabled}
          onChange={(e) => onChange({ ...value, mode: "until", until: e.target.value })}
          aria-label="End date and time, Eastern Time"
          className={inputClass}
        />,
        longDisabled,
      )}
      {radio("open", "Until I close it (no end)", undefined, longDisabled)}

      {!supported && (
        <p className="text-[11px] text-muted">
          Multi-day and open-ended polls are off until supabase/poll_duration.sql has been run in the
          Supabase SQL Editor.
        </p>
      )}
      {supported && repeatDaily && (
        <p className="text-[11px] text-muted">
          Not available while &ldquo;Repeat this poll daily&rdquo; is on. A repeating poll is always a
          one-day poll.
        </p>
      )}

      {columns ? (
        <p className="text-sm text-ink" aria-live="polite">
          {describeSchedule(columns, { openNow })}
        </p>
      ) : (
        <p className="text-[11px] text-muted">
          {value.mode === "days"
            ? `Enter a number of days from ${MIN_POLL_DAYS} to ${MAX_POLL_DAYS}.`
            : "Pick the end date and time."}
        </p>
      )}
      {emailNote && <p className="text-[11px] text-muted">{emailNote}</p>}
    </fieldset>
  );
}
