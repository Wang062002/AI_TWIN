import fs from "node:fs";
import path from "node:path";

const DEFAULT_ROOT = "data/chat_sessions";
const DEFAULT_SESSION = "default";

export function resolveSessionFile(personId, sessionId = DEFAULT_SESSION, root = DEFAULT_ROOT) {
  const safePerson = safeSegment(personId || "unknown_person");
  const safeSession = safeSegment(sessionId || DEFAULT_SESSION);
  return path.resolve(root, safePerson, `${safeSession}.jsonl`);
}

export function loadChatHistory(personId, options = {}) {
  const file = resolveSessionFile(personId, options.sessionId, options.root);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function appendChatTurn(personId, turn, options = {}) {
  const file = resolveSessionFile(personId, options.sessionId, options.root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const rows = [
    {
      role: "user",
      content: String(turn.user || ""),
      at: turn.at || new Date().toISOString()
    },
    {
      role: "assistant",
      content: String(turn.assistant || ""),
      at: turn.at || new Date().toISOString(),
      metadata: turn.metadata || {}
    }
  ];
  fs.appendFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
  return file;
}

export function toModelHistory(history, maxTurns = 6) {
  const maxMessages = Math.max(0, Number(maxTurns) * 2);
  return history
    .slice(-maxMessages)
    .filter((item) => ["user", "assistant"].includes(item.role) && item.content)
    .map((item) => ({
      role: item.role,
      content: String(item.content)
    }));
}

function safeSegment(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "default";
}
