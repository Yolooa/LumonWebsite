import {
  ApiError,
  cleanText,
  errorResponse,
  json,
  readJson,
  requireMethod,
  requireUser,
  uniqueId
} from "../_shared.js";

function todoFromRow(row) {
  return {
    id: String(row.id),
    title: String(row.title || ""),
    meta: String(row.meta || "Personal task"),
    done: Boolean(row.done),
    time: String(row.time || row.due_time || ""),
    createdAt: String(row.created_at || ""),
    updatedAt: String(row.updated_at || "")
  };
}

function routeId(context) {
  const value = context.params?.path;
  if (Array.isArray(value)) return decodeURIComponent(String(value[0] || ""));
  return decodeURIComponent(String(value || "").replace(/^\/+|\/+$/g, ""));
}

async function getOwnedTodo(db, userId, id) {
  const row = await db.prepare(
    `SELECT id, title, meta, done, due_time, created_at, updated_at
     FROM todos
     WHERE id = ? AND user_id = ?
     LIMIT 1`
  ).bind(id, userId).first();
  if (!row) throw new ApiError("待办不存在", 404, "TODO_NOT_FOUND");
  return row;
}

export async function onRequest(context) {
  try {
    const id = routeId(context);
    const { db, user } = await requireUser(context);

    if (!id) {
      if (context.request.method === "GET") {
        const result = await db.prepare(
          `SELECT id, title, meta, done, due_time, created_at, updated_at
           FROM todos
           WHERE user_id = ?
           ORDER BY done ASC, updated_at DESC, created_at DESC`
        ).bind(user.id).all();
        return json({
          success: true,
          todos: (result.results || []).map(todoFromRow)
        });
      }

      if (context.request.method === "POST") {
        const body = await readJson(context.request);
        const title = cleanText(body.title || body.text, 120);
        if (!title) throw new ApiError("待办内容不能为空", 400, "EMPTY_TODO");
        const todoId = uniqueId("todo");
        await db.prepare(
          `INSERT INTO todos (id, user_id, title, meta, done, due_time)
           VALUES (?, ?, ?, ?, 0, ?)`
        ).bind(
          todoId,
          user.id,
          title,
          cleanText(body.meta || "Personal task", 80),
          cleanText(body.time || body.dueTime, 16)
        ).run();
        const row = await getOwnedTodo(db, user.id, todoId);
        return json({ success: true, todo: todoFromRow(row) }, 201);
      }

      requireMethod(context.request, ["GET", "POST"]);
    }

    if (context.request.method === "PATCH") {
      const body = await readJson(context.request);
      const existing = await getOwnedTodo(db, user.id, id);
      const title = body.title === undefined
        ? String(existing.title)
        : cleanText(body.title, 120);
      if (!title) throw new ApiError("待办内容不能为空", 400, "EMPTY_TODO");
      const meta = body.meta === undefined
        ? String(existing.meta || "Personal task")
        : cleanText(body.meta, 80);
      const done = body.done === undefined ? Boolean(existing.done) : Boolean(body.done);
      const time = body.time === undefined
        ? String(existing.due_time || "")
        : cleanText(body.time, 16);

      await db.prepare(
        `UPDATE todos
         SET title = ?, meta = ?, done = ?, due_time = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ?`
      ).bind(title, meta, done ? 1 : 0, time, id, user.id).run();
      const row = await getOwnedTodo(db, user.id, id);
      return json({ success: true, todo: todoFromRow(row) });
    }

    if (context.request.method === "DELETE") {
      await getOwnedTodo(db, user.id, id);
      await db.prepare(
        "DELETE FROM todos WHERE id = ? AND user_id = ?"
      ).bind(id, user.id).run();
      return json({ success: true });
    }

    requireMethod(context.request, ["PATCH", "DELETE"]);
  } catch (error) {
    return errorResponse(error);
  }
}
