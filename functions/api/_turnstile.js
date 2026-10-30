/*
 * _turnstile.js — Turnstile 服务端校验（共享模块）
 * ---------------------------------------------------------------------------
 * 文件名以下划线开头，Cloudflare Pages 不会把它注册成路由，
 * 只作为其它 Function 的 import 目标（这是 Pages 的约定）。
 *
 * 校验接口：POST https://challenges.cloudflare.com/turnstile/v0/siteverify
 * 需要的环境变量：TURNSTILE_SECRET_KEY（兼容旧的 SECRET_KEY）
 */

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function turnstileSecret(env) {
    return (env && (env.TURNSTILE_SECRET_KEY || env.SECRET_KEY)) || "";
}

/**
 * 校验前端传来的 Turnstile 令牌。
 * 返回 { ok: true } 或 { ok: false, code, message, status, errors }
 */
export async function verifyTurnstile(request, env, token) {
    const secret = turnstileSecret(env);

    if (!secret) {
        return {
            ok: false,
            code: "TURNSTILE_NOT_CONFIGURED",
            status: 500,
            message:
                "服务端未配置 Turnstile 密钥：请在 Cloudflare Pages 添加环境变量 TURNSTILE_SECRET_KEY"
        };
    }

    const value = String(token || "").trim();

    if (!value) {
        return {
            ok: false,
            code: "TURNSTILE_MISSING",
            status: 400,
            message: "缺少人机验证令牌，请先完成验证再提交"
        };
    }

    const form = new FormData();

    form.append("secret", secret);
    form.append("response", value);

    const ip = request.headers.get("cf-connecting-ip");

    if (ip) {
        form.append("remoteip", ip);
    }

    try {
        const response = await fetch(VERIFY_URL, { method: "POST", body: form });
        const outcome = await response.json();

        if (outcome.success) {
            return { ok: true, code: "OK" };
        }

        return {
            ok: false,
            code: "TURNSTILE_FAILED",
            status: 403,
            message: "人机验证未通过，请重新验证后重试",
            errors: outcome["error-codes"] || []
        };
    } catch (error) {
        return {
            ok: false,
            code: "TURNSTILE_ERROR",
            status: 503,
            message: "验证服务暂时不可用，请稍后再试（" + String(error?.message || error) + "）"
        };
    }
}
