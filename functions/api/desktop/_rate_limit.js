import { ApiError } from "../_shared.js";

const encoder = new TextEncoder();

async function digest(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function limitDesktopAuth(db, request, action, identity) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS desktop_auth_limits (
      bucket TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `).run();

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const windows = action === "register"
    ? [["ip", ip, 5, 3600], ["name", identity, 3, 3600]]
    : [["ip", ip, 30, 900], ["account", identity, 8, 900]];
  const now = Math.floor(Date.now() / 1000);

  for (const [scope, value, maximum, duration] of windows) {
    const bucket = await digest(`${action}:${scope}:${String(value).toLowerCase()}`);
    const expiry = now + duration;
    await db.prepare(`
      INSERT INTO desktop_auth_limits (bucket, attempts, expires_at)
      VALUES (?, 1, ?)
      ON CONFLICT(bucket) DO UPDATE SET
        attempts = CASE WHEN expires_at <= ? THEN 1 ELSE MIN(attempts + 1, ?) END,
        expires_at = CASE WHEN expires_at <= ? THEN ? ELSE expires_at END
    `).bind(bucket, expiry, now, maximum + 1, now, expiry).run();

    const state = await db.prepare(
      "SELECT attempts FROM desktop_auth_limits WHERE bucket = ?"
    ).bind(bucket).first();
    if (!state || state.attempts > maximum) {
      throw new ApiError("尝试次数过多，请稍后再试", 429, "RATE_LIMITED");
    }
  }

  if (Math.random() < 0.01) {
    await db.prepare("DELETE FROM desktop_auth_limits WHERE expires_at < ?")
      .bind(now - 86400).run();
  }
}
