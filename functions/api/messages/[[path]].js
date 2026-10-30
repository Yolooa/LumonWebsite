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
import {
  conversationPayload,
  conversationPayloads,
  ensureConversationMember
} from "../_chat.js";

function messageFromRow(row, currentUserId) {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    senderId: String(row.sender_id),
    senderName: String(row.sender_name || row.sender_username || "用户").slice(0, 64),
    text: String(row.content || "").slice(0, 4000),
    createdAt: String(row.created_at || ""),
    mine: String(row.sender_id) === currentUserId
  };
}

function routeParts(context) {
  const raw = context.params?.path;
  return (Array.isArray(raw) ? raw : String(raw || "").split("/"))
    .map((item) => decodeURIComponent(String(item || "")))
    .filter(Boolean);
}

async function ensureFriends(db, userId, memberIds) {
  if (!memberIds.length) return new Map();
  const placeholders = memberIds.map(() => "?").join(", ");
  const result = await db.prepare(
    `SELECT u.id, u.username, u.display_name
     FROM friendships f
     JOIN users u ON u.id = f.friend_id
     WHERE f.user_id = ?
       AND f.status = 'accepted'
       AND f.friend_id IN (${placeholders})`
  ).bind(userId, ...memberIds).all();
  const found = new Map();
  for (const row of result.results || []) {
    found.set(String(row.id), {
      id: String(row.id),
      username: String(row.username || ""),
      name: String(row.display_name || row.username || "好友").slice(0, 64)
    });
  }
  return found;
}

export async function onRequest(context) {
  try {
    const { db, user } = await requireUser(context);
    const parts = routeParts(context);
    const target = String(parts[0] || "");

    if (target === "conversations" && context.request.method === "GET") {
      return json({
        success: true,
        conversations: await conversationPayloads(db, user.id)
      });
    }

    if (target === "groups" && context.request.method === "POST") {
      const body = await readJson(context.request);
      const name = cleanText(body.name, 64);
      const memberIds = [...new Set(
        (Array.isArray(body.memberIds) ? body.memberIds : [])
          .map((value) => String(value || "").trim())
          .filter((value) => value && value !== user.id)
      )].slice(0, 49);
      if (!name) throw new ApiError("群聊名称不能为空", 400, "EMPTY_GROUP_NAME");
      if (!memberIds.length) throw new ApiError("请至少选择一位好友", 400, "EMPTY_GROUP_MEMBERS");

      const friendMap = await ensureFriends(db, user.id, memberIds);
      if (friendMap.size !== memberIds.length) {
        throw new ApiError("只能邀请已添加的好友加入群聊", 403, "INVALID_GROUP_MEMBERS");
      }

      const conversationId = uniqueId("group");
      const statements = [
        db.prepare(
          `INSERT INTO conversations (id, type, title, created_by, updated_at)
           VALUES (?, 'group', ?, ?, CURRENT_TIMESTAMP)`
        ).bind(conversationId, name, user.id),
        db.prepare(
          "INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)"
        ).bind(conversationId, user.id),
        ...memberIds.map((memberId) => db.prepare(
          "INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)"
        ).bind(conversationId, memberId))
      ];
      await db.batch(statements);
      return json({
        success: true,
        conversation: await conversationPayload(db, conversationId, user.id)
      }, 201);
    }

    if (target === "conversations") requireMethod(context.request, "GET");
    if (target === "groups") requireMethod(context.request, "POST");
    if (!target) throw new ApiError("消息接口不存在", 404, "NOT_FOUND");

    const conversationId = target;
    await ensureConversationMember(db, conversationId, user.id);

    if (context.request.method === "GET") {
      const result = await db.prepare(
        `SELECT m.id, m.conversation_id, m.sender_id, m.content, m.created_at,
                u.display_name AS sender_name, u.username AS sender_username
         FROM messages m
         LEFT JOIN users u ON u.id = m.sender_id
         WHERE m.conversation_id = ?
         ORDER BY m.created_at ASC
         LIMIT 500`
      ).bind(conversationId).all();
      await db.prepare(
        `UPDATE conversation_members
         SET last_read_at = CURRENT_TIMESTAMP
         WHERE conversation_id = ? AND user_id = ?`
      ).bind(conversationId, user.id).run();
      return json({
        success: true,
        messages: (result.results || []).map((row) => messageFromRow(row, user.id))
      });
    }

    if (context.request.method === "POST") {
      const body = await readJson(context.request);
      const text = cleanText(body.text, 4000);
      if (!text) throw new ApiError("消息不能为空", 400, "EMPTY_MESSAGE");

      const conversation = await db.prepare(
        "SELECT title, type FROM conversations WHERE id = ? LIMIT 1"
      ).bind(conversationId).first();
      const members = await db.prepare(
        "SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id <> ?"
      ).bind(conversationId, user.id).all();

      const messageId = uniqueId("message");
      const statements = [
        db.prepare(
          `INSERT INTO messages (id, conversation_id, sender_id, content)
           VALUES (?, ?, ?, ?)`
        ).bind(messageId, conversationId, user.id, text),
        db.prepare(
          "UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).bind(conversationId)
      ];
      for (const member of members.results || []) {
        statements.push(
          db.prepare(
            `INSERT INTO notifications (id, user_id, kind, title, detail, url)
             VALUES (?, ?, 'message', ?, ?, 'messagessend.html')`
          ).bind(
            uniqueId("notice"),
            member.user_id,
            conversation?.type === "group"
              ? `${conversation.title || "群聊"} 有新消息`
              : `${user.name} 发来消息`,
            text.slice(0, 160)
          )
        );
      }
      await db.batch(statements);
      const row = await db.prepare(
        `SELECT id, conversation_id, sender_id, content, created_at
         FROM messages WHERE id = ? LIMIT 1`
      ).bind(messageId).first();
      return json({
        success: true,
        message: {
          ...messageFromRow(row, user.id),
          senderName: user.name,
          mine: true
        }
      }, 201);
    }

    requireMethod(context.request, ["GET", "POST"]);
  } catch (error) {
    return errorResponse(error);
  }
}
