import {
  ApiError,
  cleanText,
  createSessionResponse,
  errorResponse,
  json,
  publicUser,
  readJson,
  requireMethod,
  requireUser,
  validEmail
} from "./_shared.js";

export async function onRequest(context) {
  try {
    requireMethod(context.request, "PATCH");
    const { db, user } = await requireUser(context);
    const body = await readJson(context.request);
    const name = cleanText(body.name || body.displayName || user.name, 64);
    const email = cleanText(body.email ?? user.email, 160);
    if (!name) throw new ApiError("显示名称不能为空", 400, "INVALID_DISPLAY_NAME");
    if (!validEmail(email)) {
      throw new ApiError("邮箱格式不正确", 400, "INVALID_EMAIL");
    }

    try {
      await db.prepare(
        `UPDATE users
         SET display_name = ?, email = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).bind(name, email || null, user.id).run();
    } catch (error) {
      if (/UNIQUE|constraint/i.test(String(error?.message || error))) {
        throw new ApiError("该邮箱已被其他账户使用", 409, "EMAIL_EXISTS");
      }
      throw error;
    }

    try {
      await db.prepare(
        `INSERT INTO profiles (user_id, display_name, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id) DO UPDATE SET
           display_name = excluded.display_name,
           updated_at = CURRENT_TIMESTAMP`
      ).bind(user.id, name).run();
    } catch {
      // The users row is authoritative; the profile mirror is optional.
    }

    const row = {
      id: user.id,
      username: user.username,
      email,
      display_name: name
    };
    const session = await createSessionResponse(publicUser(row), context.env, true);
    return json(
      { success: true, user: publicUser(row) },
      200,
      { "Set-Cookie": session.cookie }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
