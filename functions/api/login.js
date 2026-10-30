/*
 * login.js — 登录接口
 * ---------------------------------------------------------------------------
 * 流程：① Cloudflare Turnstile 人机验证 → ② 校验账号密码（D1 users 表）
 *
 * 需要的环境变量：
 *   TURNSTILE_SECRET_KEY（或旧的 SECRET_KEY）—— Turnstile 私钥
 *   DB                                   —— D1 绑定
 *
 * 前端提交：{ identifier | username, password, turnstileToken }
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

    /* ---------- ② 账号校验 ---------- */
    const identifier = String(body.identifier || body.username || "").trim();
    const password = String(body.password || "");

    if (!identifier || !password) {
        return json({ success: false, code: "BAD_REQUEST", message: "请填写账号和密码" }, 400);
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
        /*
         * 兼容两种表结构：users(username,password) 与 users(username,email,password)。
         * 注意：这里按明文比较，正式环境请改为 bcrypt 之类的哈希校验。
         */
        let user;

        try {
            user = await DB.prepare(
                "SELECT * FROM users WHERE (username = ? OR email = ?) AND password = ?"
            )
                .bind(identifier, identifier, password)
                .first();
        } catch (columnErr) {
            user = await DB.prepare(
                "SELECT * FROM users WHERE username = ? AND password = ?"
            )
                .bind(identifier, password)
                .first();
        }

        if (!user) {
            return json(
                { success: false, code: "BAD_CREDENTIALS", message: "用户名或密码错误" },
                401
            );
        }

        return json({
            success: true,
            message: "登录成功",
            username: user.username,
            email: user.email || ""
        });
    } catch (error) {
        return json({ success: false, message: "服务器错误: " + error.message }, 500);
    }
}
