import {
  ApiError,
  createSessionResponse,
  errorResponse,
  json,
  publicUser,
  readJson,
  requireDb,
  requireMethod
} from "../_shared.js";
import { verifyDesktopTicket } from "../_security.js";

export async function onRequest(context) {
  try {
    requireMethod(context.request, "POST");
    const body = await readJson(context.request);
    const challenge = String(body.challenge || "");
    const payload = await verifyDesktopTicket(body.ticket, context.env, challenge);
    if (!payload) {
      throw new ApiError("桌面登录授权已失效，请重新登录", 401, "DESKTOP_TICKET_INVALID");
    }

    const db = requireDb(context.env);
    const row = await db.prepare(
      "SELECT id, username, email, display_name FROM users WHERE id = ? LIMIT 1"
    ).bind(payload.sub).first();
    if (!row) {
      throw new ApiError("账户不存在，请重新登录", 401, "UNAUTHORIZED");
    }

    const user = publicUser(row);
    const session = await createSessionResponse(user, context.env, body.remember !== false);
    return json(
      { success: true, user },
      200,
      { "Set-Cookie": session.cookie }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
