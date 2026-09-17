import { createServer } from "node:http";
import { Server } from "socket.io";
import { createClient } from "@supabase/supabase-js";
import { containsProfanity } from "./profanity.js";

const PORT = process.env.PORT || 3001;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS ||
  "https://desktopsafari.com,https://www.desktopsafari.com,http://localhost:3000"
).split(",");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const HISTORY_LIMIT = 50;
const MAX_MESSAGE_LENGTH = 500;
const MAX_NAME_LENGTH = 24;

// --- Rate limiting: per session, a minimum gap between messages plus a
// rolling-window cap so a burst of short messages still gets throttled. ---
const RATE_MIN_GAP_MS = 1500;
const RATE_WINDOW_MS = 10000;
const RATE_WINDOW_MAX = 6;
const rateState = new Map(); // sessionId -> { lastSentAt, timestamps: number[] }

function isRateLimited(sessionId) {
  const now = Date.now();
  const state = rateState.get(sessionId) ?? { lastSentAt: 0, timestamps: [] };

  if (now - state.lastSentAt < RATE_MIN_GAP_MS) {
    return true;
  }

  state.timestamps = state.timestamps.filter((t) => now - t < RATE_WINDOW_MS);
  if (state.timestamps.length >= RATE_WINDOW_MAX) {
    return true;
  }

  state.lastSentAt = now;
  state.timestamps.push(now);
  rateState.set(sessionId, state);
  return false;
}

// --- Ban cache: refreshed periodically so we're not hitting the DB on
// every single message, while still picking up new bans within ~30s. ---
let bannedSessionIds = new Set();
let bannedIps = new Set();

async function refreshBanCache() {
  const { data, error } = await supabase
    .from("chat_bans")
    .select("session_id, ip_address");

  if (error) {
    console.error("Failed to refresh ban cache:", error.message);
    return;
  }

  bannedSessionIds = new Set(data.map((b) => b.session_id).filter(Boolean));
  bannedIps = new Set(data.map((b) => b.ip_address).filter(Boolean));
}

function isBanned(sessionId, ip) {
  return bannedSessionIds.has(sessionId) || bannedIps.has(ip);
}

function getClientIp(socket) {
  const forwarded = socket.handshake.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return socket.handshake.address;
}

const httpServer = createServer();
const io = new Server(httpServer, {
  path: "/chat",
  cors: {
    origin: ALLOWED_ORIGINS,
  },
});

io.on("connection", async (socket) => {
  const { sessionId, displayName } = socket.handshake.auth ?? {};
  const ip = getClientIp(socket);

  if (
    typeof sessionId !== "string" ||
    sessionId.length === 0 ||
    typeof displayName !== "string" ||
    displayName.trim().length === 0
  ) {
    socket.emit("chat:error", "Missing session or display name.");
    socket.disconnect(true);
    return;
  }

  if (isBanned(sessionId, ip)) {
    socket.emit("chat:banned");
    socket.disconnect(true);
    return;
  }

  const { data: history, error: historyError } = await supabase
    .from("chat_messages")
    .select("id, display_name, message, created_at")
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  if (!historyError && history) {
    socket.emit("chat:history", history.reverse());
  }

  socket.on("chat:message", async (rawMessage) => {
    if (isBanned(sessionId, ip)) {
      socket.emit("chat:banned");
      socket.disconnect(true);
      return;
    }

    if (typeof rawMessage !== "string") return;

    const message = rawMessage.trim().slice(0, MAX_MESSAGE_LENGTH);
    if (message.length === 0) return;

    if (isRateLimited(sessionId)) {
      socket.emit("chat:error", "You're sending messages too quickly.");
      return;
    }

    if (containsProfanity(message)) {
      socket.emit("chat:error", "Message blocked by the language filter.");
      return;
    }

    const safeDisplayName = displayName.trim().slice(0, MAX_NAME_LENGTH);

    const { data, error } = await supabase
      .from("chat_messages")
      .insert({
        session_id: sessionId,
        display_name: safeDisplayName,
        message,
      })
      .select("id, display_name, message, created_at")
      .single();

    if (error) {
      console.error("Failed to store chat message:", error.message);
      socket.emit("chat:error", "Failed to send message, try again.");
      return;
    }

    io.emit("chat:message", data);
  });
});

refreshBanCache();
setInterval(refreshBanCache, 30000);

httpServer.listen(PORT, "127.0.0.1", () => {
  console.log(`Chat service listening on 127.0.0.1:${PORT}`);
});
