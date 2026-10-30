import {
  SESSION_COOKIE,
  DEFAULT_SESSION_SECONDS,
  SHORT_SESSION_SECONDS,
  clearSessionCookie,
  sessionCookie,
  signSession,
  verifySessionToken
} from "./_security.js";

export class ApiError extends Error {
  constructor(message, status = 400, code = "BAD_REQUEST") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers
    }
  });
}

export function errorResponse(error) {
  const status = Number(error?.status) || 500;
  const code = String(error?.code || "INTERNAL_ERROR");
  const message = status >= 500
    ? (code === "INTERNAL_ERROR" ? "服务器暂时无法处理请求" : String(error.message || "服务器错误"))
    : String(error?.message || "请求失败");
  return json({ success: false, code, message }, status);
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new ApiError("请求体不是合法 JSON", 400, "BAD_JSON");
  }
}

export function requireMethod(request, allowed) {
  const methods = Array.isArray(allowed) ? allowed : [allowed];
  if (!methods.includes(request.method)) {
    throw new ApiError("请求方法不被允许", 405, "METHOD_NOT_ALLOWED");
  }
}

export function requireDb(env) {
  if (!env?.DB) {
    throw new ApiError("服务端未绑定 D1 数据库（变量名 DB）", 500, "NO_DB_BOUND");
  }
  return env.DB;
}

export function publicUser(row) {
  if (!row) return null;
  const username = String(row.username || "");
  const name = String(row.display_name || row.displayName || username || "用户").slice(0, 64);
  return {
    id: String(row.id || ""),
    username,
    name,
    displayName: name,
    email: String(row.email || "")
  };
}

export function parseCookies(request) {
  const output = {};
  const header = request.headers.get("Cookie") || "";
  header.split(";").forEach((item) => {
    const separator = item.indexOf("=");
    if (separator < 1) return;
    output[item.slice(0, separator).trim()] = item.slice(separator + 1).trim();
  });
  return output;
}

export async function requireUser(context) {
  const db = requireDb(context.env);
  const cookies = parseCookies(context.request);
  const payload = await verifySessionToken(cookies[SESSION_COOKIE], context.env);
  if (!payload) {
    throw new ApiError("登录状态已失效，请重新登录", 401, "UNAUTHORIZED");
  }

  const row = await db.prepare(
    "SELECT id, username, email, display_name FROM users WHERE id = ? LIMIT 1"
  ).bind(payload.sub).first();
  if (!row) {
    throw new ApiError("账户不存在，请重新登录", 401, "UNAUTHORIZED");
  }
  return { db, row, user: publicUser(row) };
}

export async function createSessionResponse(user, env, remember = true) {
  const maxAge = remember ? DEFAULT_SESSION_SECONDS : SHORT_SESSION_SECONDS;
  const token = await signSession(user, env, maxAge);
  return {
    token,
    maxAge,
    cookie: sessionCookie(token, remember ? maxAge : 0)
  };
}

export function logoutCookie() {
  return clearSessionCookie();
}

export function cleanText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

export function validEmail(value) {
  if (!value) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function assertUsername(username) {
  if (username.length < 3 || username.length > 64) {
    throw new ApiError("用户名需要 3 到 64 个字符", 400, "INVALID_USERNAME");
  }
  if (/\s/.test(username)) {
    throw new ApiError("用户名不能包含空格", 400, "INVALID_USERNAME");
  }
}

export function assertPassword(password) {
  if (password.length < 8 || password.length > 256) {
    throw new ApiError("密码需要 8 到 256 个字符", 400, "WEAK_PASSWORD");
  }
}

export function uniqueId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}
