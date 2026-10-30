/*
 * submit.js — Turnstile 令牌校验接口
 * ---------------------------------------------------------------------------
 * 前端拿到 Turnstile 令牌后 POST { token } 到这里，
 * 由本函数向 Cloudflare 官方接口验证。
 *
 * 返回结构（兼容旧调用）：
 *   成功：{ status: "success", code: "OK" }
 *   失败：{ status: "fail", code, message, errors } + 对应 HTTP 状态码
 *   code 取值：NOT_CONFIGURED / MISSING_TOKEN / VERIFY_FAILED / VERIFY_ERROR
 */

import { verifyTurnstile } from "./_turnstile.js";

function json(data, status) {
    return new Response(JSON.stringify(data), {
        status: status || 200,
        headers: {
            "Content-Type": "application/json;charset=UTF-8",
            "Access-Control-Allow-Origin": "*"
        }
    });
}

export async function onRequest(context) {
    const { request, env } = context;

    if (request.method === "OPTIONS") {
        return new Response(null, {
            status: 204,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type"
            }
        });
    }

    if (request.method !== "POST") {
        return json({ status: "fail", code: "METHOD_NOT_ALLOWED" }, 405);
    }

    let token = "";

    try {
        const body = await request.json();

        token = body.token || body["cf-turnstile-response"] || "";
    } catch {
        return json(
            { status: "fail", code: "BAD_REQUEST", message: "请求体不是合法 JSON" },
            400
        );
    }

    const check = await verifyTurnstile(request, env, token);

    if (check.ok) {
        return json({ status: "success", code: "OK" });
    }

    return json(
        {
            status: "fail",
            code: check.code,
            message: check.message,
            errors: check.errors || []
        },
        check.status || 400
    );
}
