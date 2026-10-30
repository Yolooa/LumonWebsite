import { verifyTurnstile } from "./_turnstile.js";
import {
  ApiError,
  assertPassword,
  assertUsername,
  cleanText,
  createSessionResponse,
  errorResponse,
  json,
  publicUser,
  readJson,
  requireDb,
  requireMethod,
  uniqueId,
  validEmail
} from "./_shared.js";
import { hashPassword } from "./_security.js";

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

    const username = cleanText(body.username, 64);
    const displayName = cleanText(body.displayName || body.name || username, 64);
    const email = cleanText(body.email, 160);
    const password = String(body.password || "");
    assertUsername(username);
    if (displayName.length < 1) {
      throw new ApiError("显示名称不能为空", 400, "INVALID_DISPLAY_NAME");
    }
    if (!validEmail(email)) {
      throw new ApiError("邮箱格式不正确", 400, "INVALID_EMAIL");
    }
    assertPassword(password);

    const db = requireDb(context.env);
    const userId = uniqueId("user");
    const passwordHash = await hashPassword(password);

    try {
      await db.prepare(
        `INSERT INTO users (id, username, email, password_hash, display_name)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(userId, username, email || null, passwordHash, displayName).run();
    } catch (error) {
      if (/UNIQUE|constraint/i.test(String(error?.message || error))) {
        throw new ApiError("该用户名或邮箱已被注册", 409, "ALREADY_EXISTS");
      }
      throw error;
    }

    const user = {
      id: userId,
      username,
      email,
      name: displayName,
      displayName
    };
    const session = await createSessionResponse(user, context.env, true);

    try {
      await db.prepare(
        `INSERT INTO notifications (id, user_id, kind, title, detail, url)
         VALUES (?, ?, 'success', '账户已创建', '你的私人空间已经准备完成。', '')`
      ).bind(uniqueId("notice"), userId).run();
    } catch {
      // The welcome notification must not block account creation.
    }

    return json(
      { success: true, user },
      201,
      { "Set-Cookie": session.cookie }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
