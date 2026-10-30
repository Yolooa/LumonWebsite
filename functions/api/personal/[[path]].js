import {
  ApiError,
  cleanText,
  errorResponse,
  json,
  readJson,
  requireMethod,
  requireUser
} from "../_shared.js";

const DAILY_NOTE_KEY = "__daily_note__";

function segments(context) {
  const raw = context.params?.path;
  return (Array.isArray(raw) ? raw : String(raw || "").split("/"))
    .map((item) => decodeURIComponent(String(item || "")))
    .filter(Boolean);
}

function noteFromRow(row, key) {
  return {
    key,
    text: String(row?.content || ""),
    updatedAt: String(row?.updated_at || "")
  };
}

async function getNote(db, userId, key) {
  return db.prepare(
    "SELECT content, updated_at FROM personal_notes WHERE user_id = ? AND note_key = ? LIMIT 1"
  ).bind(userId, key).first();
}

async function saveNote(db, userId, key, text) {
  await db.prepare(
    `INSERT INTO personal_notes (user_id, note_key, content, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id, note_key) DO UPDATE SET
       content = excluded.content,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(userId, key, text).run();
  return noteFromRow(await getNote(db, userId, key), key);
}

export async function onRequest(context) {
  try {
    const { db, user } = await requireUser(context);
    const parts = segments(context);

    if (parts[0] === "notes" && parts.length === 1 && context.request.method === "GET") {
      const result = await db.prepare(
        `SELECT note_key, content, updated_at
         FROM personal_notes
         WHERE user_id = ? AND note_key <> ?`
      ).bind(user.id, DAILY_NOTE_KEY).all();
      const notes = {};
      for (const row of result.results || []) {
        notes[row.note_key] = noteFromRow(row, row.note_key);
      }
      return json({ success: true, notes });
    }

    if (parts[0] === "notes" && parts.length === 2 && context.request.method === "PATCH") {
      const body = await readJson(context.request);
      const key = cleanText(parts[1], 64);
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(key)) {
        throw new ApiError("注记键名不合法", 400, "INVALID_NOTE_KEY");
      }
      const note = await saveNote(db, user.id, key, cleanText(body.text, 2000));
      return json({ success: true, note });
    }

    if (parts[0] === "daily-note" && parts.length === 1 && context.request.method === "GET") {
      const row = await getNote(db, user.id, DAILY_NOTE_KEY);
      return json({
        success: true,
        note: noteFromRow(row, DAILY_NOTE_KEY)
      });
    }

    if (parts[0] === "daily-note" && parts.length === 1 && context.request.method === "PATCH") {
      const body = await readJson(context.request);
      const note = await saveNote(
        db,
        user.id,
        DAILY_NOTE_KEY,
        cleanText(body.text, 2000)
      );
      return json({ success: true, note });
    }

    if (parts[0] === "notes" && parts.length === 1) requireMethod(context.request, "GET");
    if (parts[0] === "notes" && parts.length === 2) requireMethod(context.request, "PATCH");
    if (parts[0] === "daily-note") requireMethod(context.request, ["GET", "PATCH"]);
    throw new ApiError("个人注记接口不存在", 404, "NOT_FOUND");
  } catch (error) {
    return errorResponse(error);
  }
}
