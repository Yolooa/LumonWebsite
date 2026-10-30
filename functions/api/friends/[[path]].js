import {
  ApiError,
  errorResponse,
  json,
  readJson,
  requireMethod,
  requireUser,
  uniqueId
} from "../_shared.js";
import { conversationPayload, createDirectConversation } from "../_chat.js";

function friendFromRow(row) {
  return {
    id: String(row.id),
    username: String(row.username || ""),
    name: String(row.display_name || row.username || "好友").slice(0, 64)
  };
}

export async function onRequest(context) {
  try {
    const { db, user } = await requireUser(context);
    if (context.request.method === "GET") {
      const result = await db.prepare(
        `SELECT u.id, u.username, u.display_name
         FROM friendships f
         JOIN users u ON u.id = f.friend_id
         WHERE f.user_id = ? AND f.status = 'accepted'
         ORDER BY u.display_name COLLATE NOCASE ASC, u.username COLLATE NOCASE ASC`
      ).bind(user.id).all();
      return json({
        success: true,
        friends: (result.results || []).map(friendFromRow)
      });
    }

    if (context.request.method === "POST") {
      const body = await readJson(context.request);
      const friendId = String(body.friendId || "").trim();
      if (!friendId) throw new ApiError("好友 ID 不能为空", 400, "EMPTY_FRIEND_ID");
      if (friendId === user.id) {
        throw new ApiError("不能把自己添加为好友", 400, "SELF_FRIEND");
      }

      const candidate = await db.prepare(
        `SELECT id, username, display_name
         FROM users
         WHERE id = ? OR username = ? COLLATE NOCASE
         LIMIT 1`
      ).bind(friendId, friendId).first();
      if (!candidate) {
        throw new ApiError("未找到该用户，请先验证用户名或好友 ID", 404, "USER_NOT_FOUND");
      }

      const existing = await db.prepare(
        `SELECT 1 AS found
         FROM friendships
         WHERE user_id = ? AND friend_id = ?
         LIMIT 1`
      ).bind(user.id, candidate.id).first();
      if (existing) {
        throw new ApiError("你们已经是好友", 409, "ALREADY_FRIEND");
      }

      await db.batch([
        db.prepare(
          `INSERT INTO friendships (user_id, friend_id, status)
           VALUES (?, ?, 'accepted')`
        ).bind(user.id, candidate.id),
        db.prepare(
          `INSERT INTO friendships (user_id, friend_id, status)
           VALUES (?, ?, 'accepted')`
        ).bind(candidate.id, user.id),
        db.prepare(
          `INSERT INTO notifications (id, user_id, kind, title, detail, url)
           VALUES (?, ?, 'friend', '新的好友', ?, 'messagessend.html')`
        ).bind(uniqueId("notice"), candidate.id, `${user.name} 添加你为好友`)
      ]);

      const conversationId = await createDirectConversation(
        db,
        user.id,
        candidate.id,
        candidate.display_name || candidate.username
      );
      return json({
        success: true,
        friend: friendFromRow(candidate),
        conversation: await conversationPayload(db, conversationId, user.id)
      }, 201);
    }

    requireMethod(context.request, ["GET", "POST"]);
  } catch (error) {
    if (/UNIQUE|constraint/i.test(String(error?.message || error))) {
      return errorResponse(new ApiError("你们已经是好友", 409, "ALREADY_FRIEND"));
    }
    return errorResponse(error);
  }
}
