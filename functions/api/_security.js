const encoder = new TextEncoder();

export const SESSION_COOKIE = "lumon_session";
export const DEFAULT_SESSION_SECONDS = 60 * 60 * 24 * 30;
export const SHORT_SESSION_SECONDS = 60 * 60 * 12;

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function sessionKey(env) {
  const secret = String(env?.SESSION_SECRET || "");
  if (secret.length < 32) {
    const error = new Error("SESSION_SECRET 未配置或长度不足 32 个字符");
    error.code = "SESSION_SECRET_MISSING";
    error.status = 500;
    throw error;
  }
  return encoder.encode(secret);
}

export async function signSession(user, env, maxAge = DEFAULT_SESSION_SECONDS) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: user.id,
    username: user.username,
    name: user.name || user.display_name || user.username,
    email: user.email || "",
    iat: now,
    exp: now + maxAge
  };
  const encodedPayload = base64Url(encoder.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    "raw",
    sessionKey(env),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(encodedPayload));
  return `${encodedPayload}.${base64Url(new Uint8Array(signature))}`;
}

export async function verifySessionToken(token, env) {
  if (!token || !token.includes(".")) return null;
  const [encodedPayload, encodedSignature] = token.split(".");
  if (!encodedPayload || !encodedSignature) return null;

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      sessionKey(env),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      fromBase64Url(encodedSignature),
      encoder.encode(encodedPayload)
    );
    if (!valid) return null;

    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encodedPayload)));
    if (!payload?.sub || Number(payload.exp || 0) <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function sessionCookie(token, maxAge = DEFAULT_SESSION_SECONDS) {
  const maxAgePart = maxAge ? `; Max-Age=${Math.max(0, Math.floor(maxAge))}` : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax${maxAgePart}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 100000;
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    256
  );
  return `pbkdf2$${iterations}$${base64Url(salt)}$${base64Url(new Uint8Array(bits))}`;
}

function equalBytes(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export async function verifyPassword(password, storedValue) {
  const stored = String(storedValue || "");
  if (!stored.startsWith("pbkdf2$")) {
    const ok = stored.length > 0 && stored === password;
    return { ok, needsUpgrade: ok };
  }

  const [algorithm, iterationValue, saltValue, hashValue] = stored.split("$");
  if (algorithm !== "pbkdf2" || !saltValue || !hashValue) return { ok: false, needsUpgrade: false };
  const iterations = Number(iterationValue);
  if (!Number.isFinite(iterations) || iterations < 10000) return { ok: false, needsUpgrade: false };
  if (iterations > 100000) {
    return {
      ok: false,
      needsUpgrade: false,
      unsupported: "ITERATIONS_TOO_HIGH"
    };
  }

  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: fromBase64Url(saltValue),
      iterations,
      hash: "SHA-256"
    },
    material,
    fromBase64Url(hashValue).length * 8
  );
  return {
    ok: equalBytes(new Uint8Array(bits), fromBase64Url(hashValue)),
    needsUpgrade: false
  };
}
