import {
  ApiError,
  errorResponse,
  json,
  requireMethod,
  requireUser
} from "../_shared.js";

function signalFromRow(row) {
  return {
    id: String(row.id),
    kind: ["inbox", "idea", "file"].includes(row.kind) ? row.kind : "inbox",
    title: String(row.title || ""),
    detail: String(row.detail || ""),
    time: String(row.source_updated_at || row.created_at || "")
  };
}

async function payload(db, userId) {
  const result = await db.prepare(
    `SELECT id, kind, title, detail, source_updated_at, created_at
     FROM aggregation_signals
     WHERE user_id = ?
     ORDER BY COALESCE(source_updated_at, created_at) DESC
     LIMIT 200`
  ).bind(userId).all();
  const items = (result.results || []).map(signalFromRow);
  const counts = {
    all: items.length,
    inbox: items.filter((item) => item.kind === "inbox").length,
    idea: items.filter((item) => item.kind === "idea").length,
    file: items.filter((item) => item.kind === "file").length
  };
  return { success: true, total: items.length, counts, items };
}

async function syncSignals(db, userId) {
  const [notices, todos, notes] = await Promise.all([
    db.prepare(
      `SELECT id, title, detail, created_at
       FROM notifications
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 20`
    ).bind(userId).all(),
    db.prepare(
      `SELECT id, title, meta, updated_at
       FROM todos
       WHERE user_id = ? AND done = 0
       ORDER BY updated_at DESC
       LIMIT 20`
    ).bind(userId).all(),
    db.prepare(
      `SELECT note_key, content, updated_at
       FROM personal_notes
       WHERE user_id = ? AND content <> ''
       ORDER BY updated_at DESC
       LIMIT 20`
    ).bind(userId).all()
  ]);

  const signals = [
    ...(notices.results || []).map((row) => ({
      id: `auto_notice_${row.id}`.slice(0, 120),
      kind: "inbox",
      title: String(row.title || "通知").slice(0, 140),
      detail: String(row.detail || "").slice(0, 160),
      time: String(row.created_at || "")
    })),
    ...(todos.results || []).map((row) => ({
      id: `auto_todo_${row.id}`.slice(0, 120),
      kind: "inbox",
      title: String(row.title || "待办").slice(0, 140),
      detail: String(row.meta || "Personal task").slice(0, 160),
      time: String(row.updated_at || "")
    })),
    ...(notes.results || []).map((row) => ({
      id: `auto_note_${row.note_key}`.slice(0, 120),
      kind: "idea",
      title: `个人注记 · ${row.note_key}`.slice(0, 140),
      detail: String(row.content || "").slice(0, 160),
      time: String(row.updated_at || "")
    }))
  ];

  await db.prepare(
    "DELETE FROM aggregation_signals WHERE user_id = ? AND id LIKE 'auto_%'"
  ).bind(userId).run();
  if (signals.length) {
    await db.batch(signals.map((signal) => db.prepare(
      `INSERT INTO aggregation_signals
       (id, user_id, kind, title, detail, source_updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      signal.id,
      userId,
      signal.kind,
      signal.title,
      signal.detail,
      signal.time || new Date().toISOString()
    )));
  }
}

export async function onRequest(context) {
  try {
    const { db, user } = await requireUser(context);
    const path = Array.isArray(context.params?.path)
      ? String(context.params.path[0] || "")
      : String(context.params?.path || "");

    if (!path && context.request.method === "GET") {
      return json(await payload(db, user.id));
    }

    if (path === "sync" && context.request.method === "POST") {
      await syncSignals(db, user.id);
      return json(await payload(db, user.id));
    }

    if (!path) requireMethod(context.request, "GET");
    if (path === "sync") requireMethod(context.request, "POST");
    throw new ApiError("聚合接口不存在", 404, "NOT_FOUND");
  } catch (error) {
    return errorResponse(error);
  }
}
