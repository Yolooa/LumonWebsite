import {
  ApiError,
  errorResponse,
  json,
  requireUser
} from "../_shared.js";

function routePath(context) {
  const raw = context.params?.path;
  return Array.isArray(raw)
    ? String(raw[0] || "")
    : String(raw || "").split("/").filter(Boolean)[0] || "";
}

export async function onRequest(context) {
  try {
    const { db, user } = await requireUser(context);
    const path = routePath(context);
    if (path !== "lookup" || context.request.method !== "GET") {
      throw new ApiError("用户接口不存在", 404, "NOT_FOUND");
    }

    const query = String(new URL(context.request.url).searchParams.get("query") || "").trim();
    if (!query) {
      throw new ApiError("请输入用户名或好友 ID", 400, "EMPTY_QUERY");
    }

    const candidate = await db.prepare(
      `SELECT id, username, display_name
       FROM users
       WHERE id = ? OR username = ? COLLATE NOCASE
       LIMIT 1`
    ).bind(query, query).first();
    if (!candidate) {
      return json({ success: true, found: false });
    }

    const relation = await db.prepare(
      `SELECT
         EXISTS(
           SELECT 1 FROM friendships
           WHERE status = 'accepted'
             AND ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))
         ) AS already_friend,
         EXISTS(
           SELECT 1 FROM friendships
           WHERE user_id = ? AND friend_id = ? AND status = 'pending'
         ) AS request_pending,
         EXISTS(
           SELECT 1 FROM friendships
           WHERE user_id = ? AND friend_id = ? AND status = 'pending'
         ) AS incoming_request`
    ).bind(
      user.id, candidate.id,
      candidate.id, user.id,
      user.id, candidate.id,
      candidate.id, user.id
    ).first();

    const name = String(candidate.display_name || candidate.username).slice(0, 64);
    return json({
      success: true,
      found: true,
      user: {
        id: String(candidate.id),
        username: String(candidate.username),
        name,
        displayName: name,
        alreadyFriend: Boolean(relation?.already_friend),
        requestPending: Boolean(relation?.request_pending),
        incomingRequest: Boolean(relation?.incoming_request),
        isSelf: String(candidate.id) === user.id
      }
    });
  } catch (error) {
    return errorResponse(error);
  }
}
