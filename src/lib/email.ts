import { Resend } from "resend";
import { POLL_RESULTS_EMAIL } from "@/config/constants";

type PollResultOption = {
  label: string;
  vote_count: number;
};

export async function sendPollResultsEmail(
  question: string,
  options: PollResultOption[],
) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("Missing RESEND_API_KEY, skipping poll results email");
    return;
  }

  const resend = new Resend(apiKey);
  const totalVotes = options.reduce((sum, o) => sum + o.vote_count, 0);

  const sorted = [...options].sort((a, b) => b.vote_count - a.vote_count);
  const lines = sorted.map((o) => {
    const pct = totalVotes > 0 ? Math.round((o.vote_count / totalVotes) * 100) : 0;
    return `${o.label}: ${o.vote_count} vote${o.vote_count === 1 ? "" : "s"} (${pct}%)`;
  });

  const text = [
    `Poll: ${question}`,
    `Total votes: ${totalVotes}`,
    "",
    ...lines,
  ].join("\n");

  const { error } = await resend.emails.send({
    from: "Desktop Safari Live <polls@mail.desktopsafari.com>",
    to: POLL_RESULTS_EMAIL,
    subject: `Poll results: ${question}`,
    text,
  });

  if (error) {
    console.error("Failed to send poll results email:", error);
  }
}
