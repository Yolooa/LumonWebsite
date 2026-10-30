import {
  ApiError,
  errorResponse,
  json,
  requireUser
} from "../_shared.js";

export async function onRequest(context) {
  try {
    const { db, user } = await requireUser(context);
    const path = Array.isArray(context.params?.path)
      ? String(context.params.path[0] || "")
      : String(context.params?.path || "");
    if (path !== "lookup" || context.request.method !== "GET") {
      throw new ApiError("用户接口不存在", 404, "NOT_FOUND");
    }

    const query = String(new URL(context.request.url).searchParams.get("query") || "").trim();
    if (!query) throw new ApiError("请输入用户名或好友 ID", 400, "EMPTY_QUERY");

    const candidate = await db.prepare(
      `SELECT id, username, display_name
       FROM users
       WHERE id = ? OR username = ? COLLATE NOCASE
       LIMIT 1`
    ).bind(query, query).first();
    if (!candidate) {
      return json({ success: true, found: false });
    }

    const friendship = await db.prepare(
      `SELECT 1 AS found
       FROM friendships
       WHERE user_id = ? AND friend_id = ? AND status = 'accepted'
       LIMIT 1`
    ).bind(user.id, candidate.id).first();

    return json({
      success: true,
      found: true,
      user: {
        id: String(candidate.id),
        username: String(candidate.username),
        name: String(candidate.display_name || candidate.username).slice(0, 64),
        displayName: String(candidate.display_name || candidate.username).slice(0, 64),
        alreadyFriend: Boolean(friendship),
        isSelf: String(candidate.id) === user.id
      }
    });
  } catch (error) {
    return errorResponse(error);
  }
}
