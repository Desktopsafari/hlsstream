// The poll data layer. Every read and write of polls, poll_options, votes and
// the poll_results view lives in this folder; routes, crons and the admin call
// it through this file and never query those tables themselves.
//
// Server-only. (The admin's "Hide closed polls after" control imports its
// choice list from ./visibility directly, which only has a type import of the
// Supabase client.)

export {
  createPollWithOptions,
  deletePollWithFiles,
  parseNewOptions,
  parsePendingImage,
} from "@/lib/data/polls/admin";
export { closeDuePolls, closePollAndFinish, isDueForJob, type CloseOutcome, type CronJob, type LifecycleDeps } from "@/lib/data/polls/close";
export { runClosePollJob, runOpenPollJob, type JobResponse } from "@/lib/data/polls/cron";
export {
  attachPendingImage,
  cleanupPendingPollImages,
  clearPollImage,
  deletePendingImage,
  IMAGES_SQL_HINT,
  imagesSupported,
  isPendingPath,
  loadPollImagePaths,
  pollImageUrl,
  removeFileIfUnreferenced,
  setPollImage,
  uploadPendingImage,
} from "@/lib/data/polls/images";
export { closePollNow, editPoll, hasScheduledPoll, listAdminPolls, setPollEndTime, type AdminResult } from "@/lib/data/polls/manage";
export {
  endsAtForOpening,
  getOpenNowInfo,
  openPollNow,
  openQueuedPoll,
  type OpenNowInfo,
  type OpenNowResult,
  type RepeatOutcome,
} from "@/lib/data/polls/open";
export { getPublicPollPayload } from "@/lib/data/polls/public";
export { continueRepeatingPoll, resumePausedRepeatingPoll } from "@/lib/data/polls/repeat";
export { durationColumnsExist, loadPollDuration } from "@/lib/data/polls/timing";
export { unlinkOldVotes, VOTE_LINK_RETENTION_DAYS } from "@/lib/data/polls/unlink";
export {
  getPollVisibility,
  getPublicPoll,
  hideColumnsExist,
  loadAutoHideHours,
  saveAutoHideHours,
  setPollHidden,
} from "@/lib/data/polls/visibility";
export { castVote, countVotes, findSessionVote, loadPollResults } from "@/lib/data/polls/votes";
