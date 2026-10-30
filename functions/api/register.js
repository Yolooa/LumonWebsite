/*
 * register.js — 注册接口
 * ---------------------------------------------------------------------------
 * 流程：① Cloudflare Turnstile 人机验证 → ② 写入 D1 users 表
 *
 * 需要的环境变量：
 *   TURNSTILE_SECRET_KEY（或旧的 SECRET_KEY）—— Turnstile 私钥
 *   DB                                   —— D1 绑定
 *
 * 前端提交：{ username, email, password, turnstileToken }
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
        return new Response("Method Not Allowed", { status: 405 });
    }

    let body;

    try {
        body = await request.json();
    } catch {
        return json({ success: false, code: "BAD_REQUEST", message: "请求体不是合法 JSON" }, 400);
    }

    /* ---------- ① 人机验证：没过验证一律不放行 ---------- */
    const check = await verifyTurnstile(request, env, body.turnstileToken);

    if (!check.ok) {
        return json(
            { success: false, code: check.code, message: check.message, errors: check.errors || [] },
            check.status || 403
        );
    }

    /* ---------- ② 注册 ---------- */
    const username = String(body.username || "").trim();
    const email = String(body.email || "").trim();
    const password = String(body.password || "");

    if (!username || !password) {
        return json({ success: false, code: "BAD_REQUEST", message: "用户名和密码不能为空" }, 400);
    }

    if (password.length < 6) {
        return json({ success: false, code: "WEAK_PASSWORD", message: "密码至少需要 6 个字符" }, 400);
    }

    const { DB } = env;

    if (!DB) {
        return json(
            {
                success: false,
                code: "NO_DB_BOUND",
                message: "服务端未绑定 D1 数据库（变量名 DB）"
            },
            500
        );
    }

    try {
        /* 兼容两种表结构：有 email 列就一起写，没有就退回 username/password */
        try {
            await DB.prepare(
                "INSERT INTO users (username, email, password) VALUES (?, ?, ?)"
            )
                .bind(username, email, password)
                .run();
        } catch (columnErr) {
            await DB.prepare(
                "INSERT INTO users (username, password) VALUES (?, ?)"
            )
                .bind(username, password)
                .run();
        }

        return json({ success: true, message: "注册成功", username: username, email: email });
    } catch (error) {
        const message = String(error.message || error);

        if (/UNIQUE|constraint/i.test(message)) {
            return json(
                { success: false, code: "ALREADY_EXISTS", message: "该用户名或邮箱已被注册" },
                409
            );
        }

        return json({ success: false, message: "服务器错误: " + message }, 500);
    }
}
