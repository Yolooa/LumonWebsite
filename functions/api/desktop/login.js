import {
  ApiError, cleanText, createSessionResponse, errorResponse, json,
  publicUser, readJson, requireDb, requireMethod
} from "../_shared.js";
import { hashPassword, verifyPassword } from "../_security.js";
import { limitDesktopAuth } from "./_rate_limit.js";

export async function onRequest(context) {
  try {
    requireMethod(context.request, "POST");
    const body = await readJson(context.request);
    const identifier = cleanText(body.identifier, 160);
    const password = String(body.password || "");
    if (!identifier || !password || password.length > 256) {
      throw new ApiError("请填写用户名和密码", 400, "BAD_REQUEST");
    }

    const db = requireDb(context.env);
    await limitDesktopAuth(db, context.request, "login", identifier);
    let row;
    try {
      row = await db.prepare(`
        SELECT id, username, email, display_name, password_hash FROM users
        WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE LIMIT 1
      `).bind(identifier, identifier).first();
    } catch {
      row = await db.prepare(`
        SELECT id, username, email, display_name, password AS password_hash FROM users
        WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE LIMIT 1
      `).bind(identifier, identifier).first();
    }

    if (!row) throw new ApiError("用户名或密码错误", 401, "BAD_CREDENTIALS");
    const verification = await verifyPassword(password, row.password_hash);
    if (verification.unsupported === "ITERATIONS_TOO_HIGH") {
      throw new ApiError("该账户使用了旧版密码哈希，需要重置密码后才能登录", 409,
        "PASSWORD_HASH_MIGRATION_REQUIRED");
    }
    if (!verification.ok) throw new ApiError("用户名或密码错误", 401, "BAD_CREDENTIALS");

    if (verification.needsUpgrade) {
      try {
        await db.prepare(
          "UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).bind(await hashPassword(password), row.id).run();
      } catch {
        // Older D1 installations may not have the updated_at column yet.
      }
    }

    const user = publicUser(row);
    const session = await createSessionResponse(user, context.env, body.remember !== false);
    return json({ success: true, user }, 200, { "Set-Cookie": session.cookie });
  } catch (error) {
    return errorResponse(error);
  }
}
