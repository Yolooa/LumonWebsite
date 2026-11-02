import { ApiError, errorResponse, json, requireDb, requireUser, uniqueId } from "../_shared.js";

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_FILE_BYTES + 65536;
const MAX_GAMES = 20;
const MAX_USER_BYTES = 10 * 1024 * 1024;
const CATEGORIES = new Set(["puzzle", "arcade", "reaction", "other"]);
const COLORS = new Set(["coral", "violet", "green", "blue"]);
const TABLE = `CREATE TABLE IF NOT EXISTS community_games (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('puzzle','arcade','reaction','other')),
  color TEXT NOT NULL DEFAULT 'violet' CHECK (color IN ('coral','violet','green','blue')),
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public','private')),
  filename TEXT NOT NULL,
  html TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 1048576),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;
const SELECT = `SELECT g.id, g.user_id, g.title, g.summary, g.instructions, g.category,
  g.color, g.visibility, g.filename, g.byte_size, g.created_at, g.updated_at,
  COALESCE(NULLIF(u.display_name,''),u.username) AS author, u.username
  FROM community_games g JOIN users u ON u.id = g.user_id`;

async function ensureSchema(db) {
  await db.batch([
    db.prepare(TABLE),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_community_games_public ON community_games(visibility, created_at DESC, id DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_community_games_owner ON community_games(user_id, created_at DESC, id DESC)")
  ]);
}

function gameFromRow(row, viewerId) {
  return {
    id: row.id, title: row.title, summary: row.summary, instructions: row.instructions,
    category: row.category, color: row.color, visibility: row.visibility,
    filename: row.filename, bytes: row.byte_size, author: row.author, username: row.username,
    mine: row.user_id === viewerId, createdAt: row.created_at, updatedAt: row.updated_at
  };
}

async function viewer(context, required = false) {
  try { return (await requireUser(context)).user; }
  catch (error) { if (!required && error.status === 401) return null; throw error; }
}

function requireOrigin(request) {
  // The sandboxed game frame has an opaque origin, so it cannot mutate uploads.
  if (request.headers.get("Origin") !== new URL(request.url).origin) {
    throw new ApiError("请在本站页面中上传或管理游戏", 403, "ORIGIN_REJECTED");
  }
  if (!request.headers.get("Content-Type")?.startsWith("multipart/form-data") && request.method !== "DELETE") {
    throw new ApiError("请通过游戏上传表单提交文件", 415, "MULTIPART_REQUIRED");
  }
}

function textField(form, name, max, fallback = "") {
  const value = form.get(name);
  if (value === null) return fallback;
  if (typeof value !== "string" || value.trim().length > max) {
    throw new ApiError(`${({ title: "游戏名称", summary: "游戏介绍", instructions: "操作说明" })[name] || name}过长或格式不正确`, 400, "INVALID_FIELD");
  }
  return value.trim();
}

async function readUpload(request, existing) {
  const declared = Number(request.headers.get("Content-Length"));
  if (declared > MAX_REQUEST_BYTES) throw new ApiError("游戏文件不能超过 1 MiB", 413, "FILE_TOO_LARGE");
  if (!request.body) throw new ApiError("没有收到游戏文件", 400, "EMPTY_UPLOAD");
  const reader = request.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new ApiError("游戏文件不能超过 1 MiB", 413, "FILE_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let form;
  try { form = await new Response(bytes, { headers: { "Content-Type": request.headers.get("Content-Type") } }).formData(); }
  catch { throw new ApiError("上传表单不完整，请重新选择文件", 400, "INVALID_UPLOAD"); }
  const title = textField(form, "title", 60, existing?.title || "");
  if (!title) throw new ApiError("请填写游戏名称", 400, "TITLE_REQUIRED");
  const category = textField(form, "category", 16, existing?.category || "other");
  const color = textField(form, "color", 16, existing?.color || "violet");
  const visibility = textField(form, "visibility", 16, existing?.visibility || "private");
  if (!CATEGORIES.has(category) || !COLORS.has(color) || !["public", "private"].includes(visibility)) {
    throw new ApiError("游戏分类、封面或可见范围无效", 400, "INVALID_OPTIONS");
  }
  let html = existing?.html; let filename = existing?.filename; let byteSize = existing?.byte_size;
  const file = form.get("file");
  if (file !== null) {
    if (typeof file === "string" || !file.size) throw new ApiError("请选择有效的非空 HTML 游戏文件", 400, "INVALID_FILE");
    if (!/\.html?$/i.test(file.name)) throw new ApiError("请选择 .html 或 .htm 游戏文件", 400, "HTML_REQUIRED");
    if (file.size > MAX_FILE_BYTES) throw new ApiError("游戏文件不能超过 1 MiB", 413, "FILE_TOO_LARGE");
    try { html = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()); }
    catch { throw new ApiError("请将 HTML 文件保存为 UTF-8 编码后再上传", 400, "INVALID_ENCODING"); }
    if (!/<(?:!doctype\s+html|html|head|body|canvas|script|div|main|svg)\b/i.test(html) || html.includes("\u0000")) {
      throw new ApiError("文件不是可识别的 HTML 页面", 400, "INVALID_HTML");
    }
    byteSize = new TextEncoder().encode(html).byteLength;
    filename = file.name.replace(/[\\/\u0000-\u001f]/g, "_").slice(-180);
  } else if (!existing) throw new ApiError("请先选择游戏 HTML 文件", 400, "FILE_REQUIRED");
  return { title, summary: textField(form, "summary", 180, existing?.summary || ""),
    instructions: textField(form, "instructions", 500, existing?.instructions || ""), category,
    color, visibility, filename, html, byteSize };
}

export async function onRequest(context) {
  try {
    const { request } = context;
    const method = request.method;
    if (!["GET", "POST", "PATCH", "DELETE"].includes(method)) {
      return json({ success: false, code: "METHOD_NOT_ALLOWED", message: "请求方法不被允许" }, 405, { Allow: "GET, POST, PATCH, DELETE" });
    }
    const raw = context.params?.path;
    const parts = (Array.isArray(raw) ? raw : String(raw || "").split("/")).filter(Boolean);
    if (parts.length > 1 || (parts[0] && !/^game_[a-f0-9-]{36}$/.test(parts[0]))) {
      throw new ApiError("游戏不存在", 404, "GAME_NOT_FOUND");
    }
    const id = parts[0];
    if (method !== "GET") requireOrigin(request);
    const user = await viewer(context, method !== "GET" || new URL(request.url).searchParams.get("mine") === "1");
    const db = requireDb(context.env);
    await ensureSchema(db);

    if (method === "GET" && !id) {
      const url = new URL(request.url);
      const mine = url.searchParams.get("mine") === "1";
      const offset = Math.min(10000, Math.max(0, Math.floor(Number(url.searchParams.get("offset")) || 0)));
      const where = mine ? "g.user_id = ?" : "(g.visibility = 'public' OR g.user_id = ?)";
      const result = await db.prepare(`${SELECT} WHERE ${where} ORDER BY g.created_at DESC, g.id DESC LIMIT 25 OFFSET ?`)
        .bind(user?.id || "", offset).all();
      const rows = result.results || [];
      return json({ success: true, games: rows.slice(0, 24).map((row) => gameFromRow(row, user?.id)),
        hasMore: rows.length > 24, nextOffset: rows.length > 24 ? offset + 24 : null,
        limits: { fileBytes: MAX_FILE_BYTES, games: MAX_GAMES, totalBytes: MAX_USER_BYTES } });
    }
    if (method === "GET" && id) {
      const row = await db.prepare(`SELECT g.id, g.user_id, g.title, g.summary, g.instructions, g.category,
        g.color, g.visibility, g.filename, g.byte_size, g.created_at, g.updated_at,
        g.html, COALESCE(NULLIF(u.display_name,''),u.username) AS author, u.username
        FROM community_games g JOIN users u ON u.id = g.user_id
        WHERE g.id = ? AND (g.visibility = 'public' OR g.user_id = ?) LIMIT 1`)
        .bind(id, user?.id || "").first();
      if (!row) throw new ApiError("游戏不存在，或作者已将它设为私密", 404, "GAME_NOT_FOUND");
      // Uploaded source is returned as JSON only; it never runs at the site origin.
      return json({ success: true, game: { ...gameFromRow(row, user?.id), html: row.html } }, 200,
        { "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin" });
    }

    let existing;
    if (id) {
      existing = await db.prepare("SELECT * FROM community_games WHERE id = ? AND user_id = ? LIMIT 1").bind(id, user.id).first();
      if (!existing) throw new ApiError("作品不存在，或你没有管理权限", 404, "GAME_NOT_FOUND");
    }
    if (method === "DELETE" && id) {
      await db.prepare("DELETE FROM community_games WHERE id = ? AND user_id = ?").bind(id, user.id).run();
      return json({ success: true });
    }
    if ((method === "POST" && id) || (method === "PATCH" && !id) || method === "DELETE") {
      throw new ApiError("游戏接口不存在", 404, "NOT_FOUND");
    }

    const data = await readUpload(request, existing);
    const gameId = id || uniqueId("game");
    let result;
    if (existing) {
      result = await db.prepare(`UPDATE community_games SET title = ?, summary = ?, instructions = ?, category = ?,
        color = ?, visibility = ?, filename = ?, html = ?, byte_size = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ? AND
        (SELECT COALESCE(SUM(byte_size),0) FROM community_games WHERE user_id = ? AND id <> ?) + ? <= ?`)
        .bind(data.title, data.summary, data.instructions, data.category, data.color, data.visibility,
          data.filename, data.html, data.byteSize, id, user.id, user.id, id, data.byteSize, MAX_USER_BYTES).run();
    } else {
      result = await db.prepare(`INSERT INTO community_games
        (id,user_id,title,summary,instructions,category,color,visibility,filename,html,byte_size)
        SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE
        (SELECT COUNT(*) FROM community_games WHERE user_id = ?) < ? AND
        (SELECT COALESCE(SUM(byte_size),0) FROM community_games WHERE user_id = ?) + ? <= ?`)
        .bind(gameId, user.id, data.title, data.summary, data.instructions, data.category, data.color,
          data.visibility, data.filename, data.html, data.byteSize, user.id, MAX_GAMES, user.id, data.byteSize, MAX_USER_BYTES).run();
    }
    if (!Number(result.meta?.changes)) {
      throw new ApiError("每个账号最多保存 20 款游戏，总大小最多 10 MiB，请删除旧作品或缩小文件后再试", 409, "UPLOAD_QUOTA_EXCEEDED");
    }
    const row = await db.prepare(`${SELECT} WHERE g.id = ? LIMIT 1`).bind(gameId).first();
    return json({ success: true, game: gameFromRow(row, user.id) }, existing ? 200 : 201);
  } catch (error) { return errorResponse(error); }
}
