import { ApiError, uniqueId } from "./_shared.js";

function memberFromRow(row) {
  return {
    id: String(row.id),
    username: String(row.username || ""),
    name: String(row.display_name || row.name || row.username || "用户").slice(0, 64)
  };
}

async function membersByConversation(db, conversationIds) {
  const grouped = new Map();
  if (!conversationIds.length) return grouped;
  const placeholders = conversationIds.map(() => "?").join(", ");
  const result = await db.prepare(
    `SELECT cm.conversation_id, u.id, u.username, u.display_name
     FROM conversation_members cm
     JOIN users u ON u.id = cm.user_id
     WHERE cm.conversation_id IN (${placeholders})
     ORDER BY cm.joined_at ASC`
  ).bind(...conversationIds).all();
  for (const row of result.results || []) {
    const id = String(row.conversation_id);
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push(memberFromRow(row));
  }
  return grouped;
}

function titleFor(conversation, members, userId) {
  if (conversation.type === "group") {
    return String(conversation.title || "群聊").slice(0, 80);
  }
  const other = members.find((member) => member.id !== userId);
  return other?.name || members.map((member) => member.name).join("、") || "私聊";
}

export async function conversationPayloads(db, userId) {
  const result = await db.prepare(
    `SELECT c.id, c.type, c.title, c.updated_at,
       (SELECT m.content
        FROM messages m
        WHERE m.conversation_id = c.id
        ORDER BY m.created_at DESC
        LIMIT 1) AS last_message,
       (SELECT COUNT(*)
        FROM messages unread_message
        WHERE unread_message.conversation_id = c.id
          AND unread_message.sender_id <> ?
          AND (cm.last_read_at IS NULL OR unread_message.created_at > cm.last_read_at)) AS unread
     FROM conversations c
     JOIN conversation_members cm ON cm.conversation_id = c.id
     WHERE cm.user_id = ?
     ORDER BY c.updated_at DESC`
  ).bind(userId, userId).all();
  const rows = result.results || [];
  const members = await membersByConversation(db, rows.map((row) => row.id));
  return rows.map((row) => {
    const conversationMembers = members.get(String(row.id)) || [];
    return {
      id: String(row.id),
      type: row.type === "group" ? "group" : "direct",
      title: titleFor(row, conversationMembers, userId),
      members: conversationMembers,
      lastMessage: String(row.last_message || ""),
      unread: Number(row.unread || 0),
      updatedAt: String(row.updated_at || "")
    };
  });
}

export async function conversationPayload(db, conversationId, userId) {
  const conversation = await db.prepare(
    `SELECT c.id, c.type, c.title, c.updated_at,
       (SELECT COUNT(*)
        FROM messages unread_message
        WHERE unread_message.conversation_id = c.id
          AND unread_message.sender_id <> ?
          AND (cm.last_read_at IS NULL OR unread_message.created_at > cm.last_read_at)) AS unread
     FROM conversations c
     JOIN conversation_members cm ON cm.conversation_id = c.id
     WHERE c.id = ? AND cm.user_id = ?
     LIMIT 1`
  ).bind(userId, conversationId, userId).first();
  if (!conversation) {
    throw new ApiError("会话不存在或无权访问", 404, "CONVERSATION_NOT_FOUND");
  }
  const members = await membersByConversation(db, [conversationId]);
  const conversationMembers = members.get(conversationId) || [];
  const last = await db.prepare(
    "SELECT content FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1"
  ).bind(conversationId).first();
  return {
    id: String(conversation.id),
    type: conversation.type === "group" ? "group" : "direct",
    title: titleFor(conversation, conversationMembers, userId),
    members: conversationMembers,
    lastMessage: String(last?.content || ""),
    unread: Number(conversation.unread || 0),
    updatedAt: String(conversation.updated_at || "")
  };
}

export async function ensureConversationMember(db, conversationId, userId) {
  const row = await db.prepare(
    `SELECT c.id, c.type
     FROM conversations c
     JOIN conversation_members cm ON cm.conversation_id = c.id
     WHERE c.id = ? AND cm.user_id = ?
     LIMIT 1`
  ).bind(conversationId, userId).first();
  if (!row) {
    throw new ApiError("会话不存在或无权访问", 404, "CONVERSATION_NOT_FOUND");
  }
  return row;
}

export async function findDirectConversation(db, leftUserId, rightUserId) {
  return db.prepare(
    `SELECT c.id
     FROM conversations c
     JOIN conversation_members left_member
       ON left_member.conversation_id = c.id AND left_member.user_id = ?
     JOIN conversation_members right_member
       ON right_member.conversation_id = c.id AND right_member.user_id = ?
     WHERE c.type = 'direct'
     LIMIT 1`
  ).bind(leftUserId, rightUserId).first();
}

export async function createDirectConversation(db, leftUserId, rightUserId, title) {
  const existing = await findDirectConversation(db, leftUserId, rightUserId);
  if (existing?.id) return String(existing.id);
  const id = uniqueId("direct");
  await db.batch([
    db.prepare(
      `INSERT INTO conversations (id, type, title, created_by, updated_at)
       VALUES (?, 'direct', ?, ?, CURRENT_TIMESTAMP)`
    ).bind(id, String(title || "").slice(0, 80), leftUserId),
    db.prepare(
      "INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)"
    ).bind(id, leftUserId),
    db.prepare(
      "INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)"
    ).bind(id, rightUserId)
  ]);
  return id;
}
