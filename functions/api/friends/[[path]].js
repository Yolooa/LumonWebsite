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
  createDirectConversation
} from "../_chat.js";

function routeParts(context) {
  const raw = context.params?.path;
  return (Array.isArray(raw) ? raw : String(raw || "").split("/"))
    .map((item) => decodeURIComponent(String(item || "")))
    .filter(Boolean);
}

function friendFromRow(row, explicitId = "") {
  return {
    id: String(explicitId || row.id || ""),
    username: String(row.username || ""),
    name: String(row.display_name || row.username || "用户").slice(0, 64),
    displayName: String(row.display_name || row.username || "用户").slice(0, 64)
  };
}

function requestFromRow(row, incoming) {
  return {
    id: `${row.user_id}:${row.friend_id}`,
    user: friendFromRow(row, incoming ? row.user_id : row.friend_id),
    createdAt: String(row.created_at || ""),
    incoming: Boolean(incoming)
  };
}

async function friendshipBetween(db, leftUserId, rightUserId) {
  const result = await db.prepare(
    `SELECT user_id, friend_id, status
     FROM friendships
     WHERE (user_id = ? AND friend_id = ?)
        OR (user_id = ? AND friend_id = ?)`
  ).bind(leftUserId, rightUserId, rightUserId, leftUserId).all();
  return result.results || [];
}

async function friendRequestNotification(db, userId, title, detail) {
  return db.prepare(
    `INSERT INTO notifications (id, user_id, kind, title, detail, url)
     VALUES (?, ?, 'friend_request', ?, ?, 'messagessend.html')`
  ).bind(uniqueId("notice"), userId, title.slice(0, 140), detail.slice(0, 240));
}

export async function onRequest(context) {
  try {
    const { db, user } = await requireUser(context);
    const parts = routeParts(context);
    const target = String(parts[0] || "");
    const action = String(parts[1] || "");

    if (!target && context.request.method === "GET") {
      const result = await db.prepare(
        `SELECT u.id, u.username, u.display_name
         FROM friendships f
         JOIN users u ON u.id = f.friend_id
         WHERE f.user_id = ? AND f.status = 'accepted'
         ORDER BY u.display_name COLLATE NOCASE, u.username COLLATE NOCASE`
      ).bind(user.id).all();
      return json({
        success: true,
        friends: (result.results || []).map((row) => friendFromRow(row))
      });
    }

    if (target === "requests" && !action && context.request.method === "GET") {
      const [incomingResult, outgoingResult] = await Promise.all([
        db.prepare(
          `SELECT f.user_id, f.friend_id, f.created_at, u.username, u.display_name
           FROM friendships f
           JOIN users u ON u.id = f.user_id
           WHERE f.friend_id = ? AND f.status = 'pending'
           ORDER BY f.created_at DESC`
        ).bind(user.id).all(),
        db.prepare(
          `SELECT f.user_id, f.friend_id, f.created_at, u.username, u.display_name
           FROM friendships f
           JOIN users u ON u.id = f.friend_id
           WHERE f.user_id = ? AND f.status = 'pending'
           ORDER BY f.created_at DESC`
        ).bind(user.id).all()
      ]);
      const requests = (incomingResult.results || []).map((row) => requestFromRow(row, true));
      return json({
        success: true,
        count: requests.length,
        requests,
        outgoing: (outgoingResult.results || []).map((row) => requestFromRow(row, false))
      });
    }

    if (!target && context.request.method === "POST") {
      const body = await readJson(context.request);
      const friendId = cleanText(body.friendId || body.userId, 80);
      if (!friendId) {
        throw new ApiError("请选择要添加的用户", 400, "EMPTY_FRIEND_ID");
      }

      const candidate = await db.prepare(
        `SELECT id, username, display_name
         FROM users
         WHERE id = ? OR username = ? COLLATE NOCASE
         LIMIT 1`
      ).bind(friendId, friendId).first();
      if (!candidate) {
        throw new ApiError("没有找到这个用户", 404, "USER_NOT_FOUND");
      }
      const candidateId = String(candidate.id);
      if (candidateId === user.id) {
        throw new ApiError("不能向自己发送好友申请", 400, "CANNOT_ADD_SELF");
      }

      const relations = await friendshipBetween(db, user.id, candidateId);
      for (const relation of relations) {
        const status = String(relation.status || "");
        const outgoing = String(relation.user_id) === user.id;
        if (status === "accepted") {
          throw new ApiError("你们已经是好友", 409, "ALREADY_FRIEND");
        }
        if (status === "pending" && outgoing) {
          throw new ApiError("好友申请已发送，请等待对方处理", 409, "ALREADY_REQUESTED");
        }
        if (status === "pending" && !outgoing) {
          throw new ApiError("对方已经向你发送了好友申请，请到申请入口处理", 409, "INCOMING_REQUEST_EXISTS");
        }
        if (status === "blocked") {
          throw new ApiError("当前无法向该用户发送好友申请", 403, "FRIEND_REQUEST_BLOCKED");
        }
      }

      const inserted = await db.prepare(
        `INSERT OR IGNORE INTO friendships (user_id, friend_id, status, created_at)
         VALUES (?, ?, 'pending', CURRENT_TIMESTAMP)`
      ).bind(user.id, candidateId).run();
      if (!Number(inserted.meta?.changes || 0)) {
        const latestRelations = await friendshipBetween(db, user.id, candidateId);
        const nowAccepted = latestRelations.some((relation) => relation.status === "accepted");
        const incomingPending = latestRelations.some((relation) => (
          relation.status === "pending" && String(relation.user_id) !== user.id
        ));
        const outgoingPending = latestRelations.some((relation) => (
          relation.status === "pending" && String(relation.user_id) === user.id
        ));
        throw new ApiError(
          nowAccepted
            ? "你们已经是好友"
            : incomingPending
              ? "对方已经向你发送了好友申请，请到申请入口处理"
              : "好友申请已经存在，请等待对方处理",
          409,
          nowAccepted
            ? "ALREADY_FRIEND"
            : incomingPending
              ? "INCOMING_REQUEST_EXISTS"
              : outgoingPending
                ? "ALREADY_REQUESTED"
                : "REQUEST_NOT_CREATED"
        );
      }

      try {
        await friendRequestNotification(
          db,
          candidateId,
          `${user.name} 请求添加你为好友`,
          "前往私聊页查看并处理好友申请"
        ).run();
      } catch (notificationError) {
        // The request itself must not fail when the secondary notification write fails.
        console.error("friend-request notification failed", notificationError);
      }
      return json({
        success: true,
        pending: true,
        message: "好友申请已发送，等待对方同意",
        request: {
          id: `${user.id}:${candidateId}`,
          user: friendFromRow(candidate),
          incoming: false
        }
      }, 201);
    }

    if (target === "requests" && action === "accept" && context.request.method === "POST") {
      const body = await readJson(context.request);
      const requesterId = cleanText(body.requesterId || body.userId, 80);
      if (!requesterId) {
        throw new ApiError("申请人不明，无法处理", 400, "EMPTY_REQUESTER_ID");
      }
      const pending = await db.prepare(
        `SELECT f.user_id, f.friend_id, f.created_at, u.username, u.display_name
         FROM friendships f
         JOIN users u ON u.id = f.user_id
         WHERE f.user_id = ? AND f.friend_id = ? AND f.status = 'pending'
         LIMIT 1`
      ).bind(requesterId, user.id).first();
      if (!pending) {
        throw new ApiError("这条好友申请已失效", 404, "REQUEST_NOT_FOUND");
      }

      await db.prepare(
        `UPDATE friendships
         SET status = 'accepted'
         WHERE user_id = ? AND friend_id = ? AND status = 'pending'`
      ).bind(requesterId, user.id).run();
      await db.prepare(
        `INSERT OR IGNORE INTO friendships (user_id, friend_id, status, created_at)
         VALUES (?, ?, 'accepted', CURRENT_TIMESTAMP)`
      ).bind(user.id, requesterId).run();

      try {
        await friendRequestNotification(
          db,
          requesterId,
          `${user.name} 已同意你的好友申请`,
          "现在可以开始私聊了"
        ).run();
      } catch (notificationError) {
        console.error("friend-accept notification failed", notificationError);
      }

      const conversationId = await createDirectConversation(
        db,
        requesterId,
        user.id,
        user.name
      );
      return json({
        success: true,
        friend: friendFromRow(pending, requesterId),
        conversation: await conversationPayload(db, conversationId, user.id)
      });
    }

    if (target === "requests" && action === "reject" && context.request.method === "POST") {
      const body = await readJson(context.request);
      const requesterId = cleanText(body.requesterId || body.userId, 80);
      if (!requesterId) {
        throw new ApiError("申请人不明，无法处理", 400, "EMPTY_REQUESTER_ID");
      }
      const result = await db.prepare(
        `DELETE FROM friendships
         WHERE user_id = ? AND friend_id = ? AND status = 'pending'`
      ).bind(requesterId, user.id).run();
      if (!Number(result.meta?.changes || 0)) {
        throw new ApiError("这条好友申请已失效", 404, "REQUEST_NOT_FOUND");
      }
      return json({ success: true, rejected: true });
    }

    if (target === "requests") {
      requireMethod(context.request, "GET");
    }
    if (target && target !== "requests") {
      throw new ApiError("好友接口不存在", 404, "NOT_FOUND");
    }
    requireMethod(context.request, ["GET", "POST"]);
    throw new ApiError("好友接口不存在", 404, "NOT_FOUND");
  } catch (error) {
    console.error("friends-api", {
      method: context.request.method,
      path: new URL(context.request.url).pathname,
      code: error?.code || "INTERNAL_ERROR",
      message: error?.message || String(error)
    });
    return errorResponse(error);
  }
}
