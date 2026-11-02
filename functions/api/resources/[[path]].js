import { ApiError, errorResponse, json, requireDb, requireUser, uniqueId } from "../_shared.js";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_FILE_BYTES + 65536;
const MAX_FILES = 50;
const MAX_LIST_FILES = 500;
const MAX_USER_BYTES = 200 * 1024 * 1024;
const MAX_GLOBAL_BYTES = 8 * 1024 * 1024 * 1024;
const MAX_DAILY_USER_WRITES = 50;
const MAX_DAILY_GLOBAL_WRITES = 500;
const MAX_MONTHLY_GLOBAL_WRITES = 20_000;
const MAX_DAILY_USER_DOWNLOADS = 500;
const MAX_DAILY_USER_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_DAILY_GLOBAL_DOWNLOADS = 5_000;
const MAX_DAILY_GLOBAL_DOWNLOAD_BYTES = 20 * 1024 * 1024 * 1024;
const MAX_MONTHLY_GLOBAL_DOWNLOADS = 200_000;
const MAX_MONTHLY_GLOBAL_DOWNLOAD_BYTES = 512 * 1024 * 1024 * 1024;

const TYPES = {
  pdf: { mime: "application/pdf", category: "document", magic: (b) => ascii(b, 0, "%PDF-") },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", category: "document", magic: zipMagic },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", category: "document", magic: zipMagic },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", category: "document", magic: zipMagic },
  txt: { mime: "text/plain; charset=utf-8", category: "document", magic: textMagic },
  md: { mime: "text/markdown; charset=utf-8", category: "document", magic: textMagic },
  csv: { mime: "text/csv; charset=utf-8", category: "document", magic: textMagic },
  json: { mime: "application/json", category: "document", magic: jsonMagic },
  png: { mime: "image/png", category: "image", magic: (b) => b.length >= 8 && [137,80,78,71,13,10,26,10].every((n, i) => b[i] === n) },
  jpg: { mime: "image/jpeg", category: "image", magic: (b) => b[0] === 255 && b[1] === 216 && b[2] === 255 },
  jpeg: { mime: "image/jpeg", category: "image", magic: (b) => b[0] === 255 && b[1] === 216 && b[2] === 255 },
  gif: { mime: "image/gif", category: "image", magic: (b) => ascii(b, 0, "GIF8") },
  webp: { mime: "image/webp", category: "image", magic: (b) => ascii(b, 0, "RIFF") && ascii(b, 8, "WEBP") },
  zip: { mime: "application/zip", category: "archive", magic: zipMagic },
  mp3: { mime: "audio/mpeg", category: "audio", magic: (b) => ascii(b, 0, "ID3") || (b[0] === 255 && (b[1] & 224) === 224) },
  wav: { mime: "audio/wav", category: "audio", magic: (b) => ascii(b, 0, "RIFF") && ascii(b, 8, "WAVE") },
  mp4: { mime: "video/mp4", category: "video", magic: (b) => ascii(b, 4, "ftyp") }
};

const TABLE = `CREATE TABLE IF NOT EXISTS user_resources (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  extension TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('document','image','audio','video','archive','other')),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 20971520),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;
const USAGE_TABLE = `CREATE TABLE IF NOT EXISTS resource_usage_limits (
  scope TEXT NOT NULL,
  period TEXT NOT NULL,
  owner TEXT NOT NULL,
  operation_count INTEGER NOT NULL DEFAULT 0 CHECK (operation_count >= 0),
  byte_count INTEGER NOT NULL DEFAULT 0 CHECK (byte_count >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (scope, period, owner)
)`;

const ascii = (bytes, offset, text) => text.split("").every((char, index) => bytes[offset + index] === char.charCodeAt(0));
const zipMagic = (bytes) => bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && [0x03, 0x05, 0x07].includes(bytes[2]);

function textMagic(bytes) {
  if (!bytes.length || bytes.includes(0)) return false;
  try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); return true; }
  catch { return false; }
}

function jsonMagic(bytes) {
  if (!textMagic(bytes)) return false;
  try { JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); return true; }
  catch { return false; }
}

function cleanFilename(value) {
  const name = String(value || "").normalize("NFC")
    .replace(/[\\/\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "_")
    .replace(/^\.+/, "").trim().slice(0, 180);
  if (!name || name === "." || name === "..") throw new ApiError("文件名无效", 400, "INVALID_FILENAME");
  return name;
}

function downloadHeaders(filename, size) {
  const fallback = filename.normalize("NFKD").replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(filename).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return {
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`,
    "Content-Length": String(size),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin"
  };
}

async function ensureSchema(db) {
  await db.batch([
    db.prepare(TABLE),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_user_resources_owner ON user_resources(user_id, created_at DESC, id DESC)"),
    db.prepare(USAGE_TABLE)
  ]);
}

function usagePeriod(monthly) {
  const now = new Date();
  return monthly ? now.toISOString().slice(0, 7) : now.toISOString().slice(0, 10);
}

async function reserveUsage(db, scope, period, owner, maxOperations, maxBytes, bytes = 0) {
  await db.prepare(`INSERT OR IGNORE INTO resource_usage_limits (scope,period,owner)
    VALUES (?,?,?)`).bind(scope, period, owner).run();
  const result = await db.prepare(`UPDATE resource_usage_limits
    SET operation_count = CASE WHEN period = ? THEN operation_count + 1 ELSE 1 END,
        byte_count = CASE WHEN period = ? THEN byte_count + ? ELSE ? END,
        period = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE scope = ? AND owner = ?
      AND (period < ? OR (period = ? AND operation_count < ? AND byte_count + ? <= ?))`)
    .bind(period, period, bytes, bytes, period, scope, owner, period, period, maxOperations, bytes, maxBytes).run();
  if (!Number(result.meta?.changes)) {
    throw new ApiError("个人或全站资源额度已达到上限，请在 UTC 日/月额度重置后再试", 429, "RESOURCE_USAGE_LIMIT");
  }
  return { scope, period, owner, bytes };
}

async function releaseUsage(db, reservation) {
  if (!reservation) return;
  await db.prepare(`UPDATE resource_usage_limits
    SET operation_count = MAX(0, operation_count - 1),
        byte_count = MAX(0, byte_count - ?),
        updated_at = CURRENT_TIMESTAMP
    WHERE scope = ? AND period = ? AND owner = ?`)
    .bind(reservation.bytes, reservation.scope, reservation.period, reservation.owner).run();
}

async function reserveMany(db, requests) {
  const reservations = [];
  try {
    for (const request of requests) reservations.push(await reserveUsage(db, ...request));
    return reservations;
  } catch (error) {
    await releasePair(db, reservations);
    throw error;
  }
}

async function releasePair(db, reservations) {
  await Promise.all(reservations.map((reservation) => releaseUsage(db, reservation)));
}

async function readMultipart(request) {
  if (!request.body) throw new ApiError("没有收到上传数据", 400, "EMPTY_UPLOAD");
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new ApiError("单个文件最多 20 MiB", 413, "FILE_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return await new Response(bytes, { headers: { "Content-Type": request.headers.get("Content-Type") } }).formData();
  } catch { throw new ApiError("上传数据不完整，请重新选择文件", 400, "INVALID_UPLOAD"); }
}

function requireOrigin(request) {
  if (request.headers.get("Origin") !== new URL(request.url).origin) {
    throw new ApiError("请在 Lumon 个人资源空间中执行此操作", 403, "ORIGIN_REJECTED");
  }
}

function accountStats(db, userId) {
  return db.prepare("SELECT COUNT(*) AS file_count, COALESCE(SUM(byte_size),0) AS used_bytes FROM user_resources WHERE user_id = ?")
    .bind(userId).first();
}

export async function onRequest(context) {
  try {
    const { request, env } = context;
    const method = request.method;
    if (!["GET", "POST", "DELETE"].includes(method)) {
      return json({ success: false, code: "METHOD_NOT_ALLOWED", message: "请求方法不被允许" }, 405, { Allow: "GET, POST, DELETE" });
    }
    const raw = context.params?.path;
    const parts = (Array.isArray(raw) ? raw : String(raw || "").split("/")).filter(Boolean);
    if (parts.length > 1 || (parts[0] && !/^resource_[a-f0-9-]{36}$/.test(parts[0]))) {
      throw new ApiError("文件不存在", 404, "RESOURCE_NOT_FOUND");
    }
    const id = parts[0];
    if (method !== "GET") requireOrigin(request);
    const { user, db } = await requireUser(context);
    const bucket = env.RESOURCE_BUCKET;
    if (!bucket) throw new ApiError("文件空间尚未绑定 Cloudflare R2（变量名 RESOURCE_BUCKET）", 503, "R2_NOT_BOUND");
    await ensureSchema(db);

    if (method === "GET" && !id) {
      const [result, stats, globalStats] = await Promise.all([
        db.prepare(`SELECT id,filename,extension,category,byte_size,created_at
          FROM user_resources WHERE user_id = ? ORDER BY created_at DESC,id DESC LIMIT ?`).bind(user.id, MAX_LIST_FILES).all(),
        accountStats(db, user.id),
        db.prepare("SELECT COALESCE(SUM(byte_size),0) AS used_bytes FROM user_resources").first()
      ]);
      const today = usagePeriod(false);
      const todayUsage = await db.prepare(`SELECT operation_count,byte_count FROM resource_usage_limits
        WHERE scope='user_download' AND period=? AND owner=?`).bind(today, user.id).first();
      return json({ success: true, files: result.results || [], quota: {
        files: MAX_FILES, fileBytes: MAX_FILE_BYTES, totalBytes: MAX_USER_BYTES,
        usedFiles: Number(stats?.file_count || 0), usedBytes: Number(stats?.used_bytes || 0),
        globalBytes: Number(globalStats?.used_bytes || 0), globalLimitBytes: MAX_GLOBAL_BYTES,
        dailyDownloadLimit: MAX_DAILY_USER_DOWNLOADS,
        dailyDownloadBytesLimit: MAX_DAILY_USER_DOWNLOAD_BYTES,
        todayDownloads: Number(todayUsage?.operation_count || 0),
        todayDownloadBytes: Number(todayUsage?.byte_count || 0)
      } });
    }

    if (method === "POST") {
      if (id) throw new ApiError("上传接口不存在", 404, "NOT_FOUND");
      if (!request.headers.get("Content-Type")?.startsWith("multipart/form-data")) {
        throw new ApiError("请通过上传表单选择文件", 415, "MULTIPART_REQUIRED");
      }
      const length = Number(request.headers.get("Content-Length"));
      if (length > MAX_REQUEST_BYTES) throw new ApiError("单个文件最多 20 MiB", 413, "FILE_TOO_LARGE");
      const form = await readMultipart(request);
      if (form.get("rulesAccepted") !== "on") throw new ApiError("请先确认上传安全条例", 400, "RULES_REQUIRED");
      const file = form.get("file");
      if (!file || typeof file === "string" || !file.size) throw new ApiError("请选择非空文件", 400, "FILE_REQUIRED");
      if (file.size > MAX_FILE_BYTES) throw new ApiError("单个文件最多 20 MiB", 413, "FILE_TOO_LARGE");
      const filename = cleanFilename(file.name);
      const extension = filename.includes(".") ? filename.split(".").at(-1).toLowerCase() : "";
      const policy = TYPES[extension];
      if (!policy) throw new ApiError("不支持此文件类型。禁止网页、脚本、安装包和可执行文件", 415, "FILE_TYPE_BLOCKED");
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!policy.magic(bytes)) throw new ApiError("文件内容与扩展名不匹配，已拒绝上传", 415, "FILE_SIGNATURE_MISMATCH");

      const stats = await accountStats(db, user.id);
      if (Number(stats?.file_count || 0) >= MAX_FILES || Number(stats?.used_bytes || 0) + file.size > MAX_USER_BYTES) {
        throw new ApiError("个人空间已满：每个账号最多 50 个文件、合计 200 MiB", 409, "QUOTA_EXCEEDED");
      }
      const globalStats = await db.prepare("SELECT COALESCE(SUM(byte_size),0) AS used_bytes FROM user_resources").first();
      if (Number(globalStats?.used_bytes || 0) + file.size > MAX_GLOBAL_BYTES) {
        throw new ApiError("全站共享存储空间已达到安全上限，暂时无法接收新文件", 429, "GLOBAL_STORAGE_LIMIT");
      }
      const month = usagePeriod(true);
      const day = usagePeriod(false);
      const reservations = await reserveMany(db, [
        ["user_write", day, user.id, MAX_DAILY_USER_WRITES, 0, 0],
        ["global_write_day", day, "*", MAX_DAILY_GLOBAL_WRITES, 0, 0],
        ["global_write_month", month, "*", MAX_MONTHLY_GLOBAL_WRITES, 0, 0]
      ]);
      const idNew = uniqueId("resource");
      const key = `private/${crypto.randomUUID()}`;
      try {
        await bucket.put(key, bytes, {
          httpMetadata: { contentType: "application/octet-stream", cacheControl: "private, no-store" },
          customMetadata: { owner: user.id, resourceId: idNew, originalName: filename }
        });
      } catch (error) { throw error; }
      let saved;
      try {
        saved = await db.prepare(`INSERT INTO user_resources (id,user_id,r2_key,filename,extension,category,byte_size)
          SELECT ?,?,?,?,?,?,? WHERE
          (SELECT COUNT(*) FROM user_resources WHERE user_id = ?) < ? AND
          (SELECT COALESCE(SUM(byte_size),0) FROM user_resources WHERE user_id = ?) + ? <= ? AND
          (SELECT COALESCE(SUM(byte_size),0) FROM user_resources) + ? <= ?`)
          .bind(idNew, user.id, key, filename, extension, policy.category, file.size,
            user.id, MAX_FILES, user.id, file.size, MAX_USER_BYTES, file.size, MAX_GLOBAL_BYTES).run();
      } catch (error) {
        await bucket.delete(key);
        throw error;
      }
      if (!Number(saved.meta?.changes)) {
        await bucket.delete(key);
        throw new ApiError("个人或全站共享存储空间已达到安全上限", 429, "STORAGE_LIMIT");
      }
      return json({ success: true, file: { id: idNew, filename, extension, category: policy.category, byte_size: file.size, created_at: new Date().toISOString() } }, 201);
    }

    const row = await db.prepare(`SELECT id,user_id,r2_key,filename,extension,category,byte_size,created_at
      FROM user_resources WHERE id = ? AND user_id = ? LIMIT 1`).bind(id, user.id).first();
    if (!row) throw new ApiError("文件不存在或不属于当前账号", 404, "RESOURCE_NOT_FOUND");

    if (method === "DELETE") {
      const day = usagePeriod(false);
      const reservations = await reserveMany(db, [
        ["user_write", day, user.id, MAX_DAILY_USER_WRITES, 0, 0],
        ["global_write_day", day, "*", MAX_DAILY_GLOBAL_WRITES, 0, 0],
        ["global_write_month", usagePeriod(true), "*", MAX_MONTHLY_GLOBAL_WRITES, 0, 0]
      ]);
      await bucket.delete(row.r2_key);
      await db.prepare("DELETE FROM user_resources WHERE id = ? AND user_id = ?").bind(id, user.id).run();
      return json({ success: true });
    }

    const day = usagePeriod(false);
    const size = Number(row.byte_size);
    const reservations = await reserveMany(db, [
      ["user_download", day, user.id, MAX_DAILY_USER_DOWNLOADS, MAX_DAILY_USER_DOWNLOAD_BYTES, size],
      ["global_download_day", day, "*", MAX_DAILY_GLOBAL_DOWNLOADS, MAX_DAILY_GLOBAL_DOWNLOAD_BYTES, size],
      ["global_download_month", usagePeriod(true), "*", MAX_MONTHLY_GLOBAL_DOWNLOADS, MAX_MONTHLY_GLOBAL_DOWNLOAD_BYTES, size]
    ]);
    let object;
    object = await bucket.get(row.r2_key);
    if (!object) {
      throw new ApiError("文件对象暂时不可用，请稍后重试", 404, "OBJECT_NOT_FOUND");
    }
    return new Response(object.body, { status: 200, headers: downloadHeaders(row.filename, row.byte_size) });
  } catch (error) { return errorResponse(error); }
}
