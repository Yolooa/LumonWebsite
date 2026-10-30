import {
  ApiError,
  errorResponse,
  json,
  requireMethod,
  requireUser
} from "../_shared.js";

function noticeFromRow(row) {
  return {
    id: String(row.id),
    kind: String(row.kind || "system"),
    title: String(row.title || ""),
    detail: String(row.detail || ""),
    url: String(row.url || ""),
    read: Boolean(row.is_read),
    createdAt: String(row.created_at || "")
  };
}

export async function onRequest(context) {
  try {
    const { db, user } = await requireUser(context);
    const path = Array.isArray(context.params?.path)
      ? String(context.params.path[0] || "")
      : String(context.params?.path || "");

    if (!path && context.request.method === "GET") {
      const result = await db.prepare(
        `SELECT id, kind, title, detail, url, is_read, created_at
         FROM notifications
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT 100`
      ).bind(user.id).all();
      const items = (result.results || []).map(noticeFromRow);
      return json({
        success: true,
        unread: items.filter((item) => !item.read).length,
        notifications: items
      });
    }

    if (path === "read" && context.request.method === "POST") {
      await db.prepare(
        "UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0"
      ).bind(user.id).run();
      return json({ success: true });
    }

    if (!path) requireMethod(context.request, "GET");
    if (path === "read") requireMethod(context.request, "POST");
    throw new ApiError("通知接口不存在", 404, "NOT_FOUND");
  } catch (error) {
    return errorResponse(error);
  }
}
