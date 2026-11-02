// Push notification limits and labels shared by the server and the admin /
// visitor components. Nothing here may import server-only code: the browser
// bundle includes this file.

export const PUSH_TITLE_MAX = 60;
export const PUSH_MESSAGE_MAX = 140;

// 0 = Sunday ... 6 = Saturday, the same numbering as Date.getUTCDay().
export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export const PUSH_SQL_HINT =
  "Push notifications need their database tables first: run supabase/push_notifications.sql in the Supabase SQL Editor.";
export const PUSH_KEYS_HINT =
  "Push notifications need the VAPID keys: set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT in the environment.";
