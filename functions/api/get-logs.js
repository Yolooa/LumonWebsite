export async function onRequest(context) {
    // 1. 应对浏览器的 CORS 预检
    if (context.request.method === "OPTIONS") {
        return new Response(null, {
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, X-Dashboard-Token",
            },
        });
    }

    try {
        // 2. 校验密码
        const securePassword = context.env.DASHBOARD_PASSWORD;
        const clientToken = context.request.headers.get("X-Dashboard-Token");

        /*
         * 必须区分「口令错」和「服务端没配口令」：
         * 之前两种情况都返回 401，前端只能提示"凭证校验失败"，
         * 运维时根本看不出是密码输错还是环境变量漏配，会一直卡在登录页。
         */
        if (!securePassword) {
            return new Response(
                JSON.stringify({
                    error: "服务端未配置访问口令",
                    hint: "请在 Cloudflare Pages 的 Settings → Environment variables 添加 DASHBOARD_PASSWORD（本地则写在 .dev.vars）",
                    code: "NO_PASSWORD_CONFIGURED"
                }),
                {
                    status: 500,
                    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
                }
            );
        }

        if (clientToken !== securePassword) {
            return new Response(
                JSON.stringify({ error: "口令不正确", code: "BAD_PASSWORD" }),
                {
                    status: 401,
                    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
                }
            );
        }

        // 3. 释放 D1 数据
        const { DB } = context.env;

        if (!DB) {
            return new Response(
                JSON.stringify({
                    error: "服务端未绑定 D1 数据库",
                    hint: "请在 Cloudflare Pages 绑定名为 DB 的 D1 数据库",
                    code: "NO_DB_BOUND"
                }),
                {
                    status: 500,
                    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
                }
            );
        }

        /*
         * 读取访问记录。
         * 两个容错点（线上 D1 与本地 SQLite 都要能跑）：
         *   1. 排序字段 visit_time 只有建表时带默认值才存在，缺失时退回 rowid；
         *   2. 支持 ?limit=N 让 dashboard 取更多记录（默认 100，上限 500）。
         */
        const url = new URL(context.request.url);
        const limit = Math.min(
            Math.max(Number(url.searchParams.get("limit")) || 100, 1),
            500
        );

        let results;

        try {
            ({ results } = await DB.prepare(
                `SELECT * FROM site_visits ORDER BY visit_time DESC LIMIT ${limit}`
            ).all());
        } catch (orderErr) {
            ({ results } = await DB.prepare(
                `SELECT * FROM site_visits ORDER BY rowid DESC LIMIT ${limit}`
            ).all());
        }

        return new Response(JSON.stringify(results), {
            headers: { 
                "Content-Type": "application/json", 
                "Access-Control-Allow-Origin": "*" 
            }
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message, code: "UPSTREAM_ERROR" }), { 
            status: 500,
            headers: { "Access-Control-Allow-Origin": "*" }
        });
    }
}
