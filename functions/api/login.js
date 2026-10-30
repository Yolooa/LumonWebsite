import { verifyTurnstile } from "./_turnstile.js";
import {
  ApiError,
  cleanText,
  createSessionResponse,
  errorResponse,
  json,
  publicUser,
  readJson,
  requireDb,
  requireMethod
} from "./_shared.js";
import { hashPassword, verifyPassword } from "./_security.js";

export async function onRequest(context) {
  try {
    requireMethod(context.request, "POST");
    const body = await readJson(context.request);
    const check = await verifyTurnstile(
      context.request,
      context.env,
      body.turnstileToken
    );
    if (!check.ok) {
      return json(
        { success: false, code: check.code, message: check.message, errors: check.errors || [] },
        check.status || 403
      );
    }

    const identifier = cleanText(body.identifier || body.username, 160);
    const password = String(body.password || "");
    if (!identifier) throw new ApiError("请填写用户名或邮箱", 400, "BAD_REQUEST");
    if (!password || password.length > 256) {
      throw new ApiError("密码格式不正确", 400, "INVALID_PASSWORD");
    }

    const db = requireDb(context.env);
    let row;
    try {
      row = await db.prepare(
        `SELECT id, username, email, display_name, password_hash
         FROM users
         WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE
         LIMIT 1`
      ).bind(identifier, identifier).first();
    } catch {
      row = await db.prepare(
        `SELECT id, username, email, display_name, password AS password_hash
         FROM users
         WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE
         LIMIT 1`
      ).bind(identifier, identifier).first();
    }

    if (!row) {
      throw new ApiError("用户名或密码错误", 401, "BAD_CREDENTIALS");
    }

    const verification = await verifyPassword(password, row.password_hash);
    if (verification.unsupported === "ITERATIONS_TOO_HIGH") {
      throw new ApiError(
        "该账户使用了旧版密码哈希，需要重置密码后才能登录",
        409,
        "PASSWORD_HASH_MIGRATION_REQUIRED"
      );
    }
    if (!verification.ok) {
      throw new ApiError("用户名或密码错误", 401, "BAD_CREDENTIALS");
    }

    if (verification.needsUpgrade) {
      try {
        const upgraded = await hashPassword(password);
        await db.prepare(
          "UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).bind(upgraded, row.id).run();
      } catch {
        // Existing installations are upgraded by the final D1 migration.
      }
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
