export async function onRequest(context) {
    // 1. 处理 CORS 预检，彻底告别 405
    if (context.request.method === "OPTIONS") {
        return new Response(null, {
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type",
            },
        });
    }

    if (context.request.method === "POST") {
        try {
            const { DB } = context.env;
            const body = await context.request.json();
            const clean = (value, max) =>
                value == null || value === ""
                    ? null
                    : String(value).slice(0, max || 120);

            const device = clean(body.device, 40);
            const browser = clean(body.browser, 40);
            const pageName = clean(body.page, 120) || "index.html";

            /* 设备身份与型号：浏览器拿不到硬件唯一 ID，这里是客户端生成 + 指纹 */
            const deviceId = clean(body.device_id, 64);
            const fingerprint = clean(body.fingerprint, 64);
            const model = clean(body.model, 80);
            const platform = clean(body.platform, 60);
            const gpu = clean(body.gpu, 80);
            const screenInfo = clean(body.screen, 40);
            const network = clean(body.network, 40);
            const tz = clean(body.tz, 60);
            const referrer = clean(body.referrer, 200);
            const cores = Number(body.cores) || null;
            const memory = Number(body.memory) || null;
            
            // 2. 从 Cloudflare 边缘网络静默抓取 IP 和地理位置
            const ip = context.request.headers.get("cf-connecting-ip") || "未知 IP";
            const cf = context.request.cf || {};
            
            // 拼接大厂风格的标签：例如 "中国 · 天津市"
            const country = cf.country === "CN" ? "中国" : (cf.country || "未知国家");
            const region = cf.region || "";
            const city = cf.city || "";
            const location = `${country} · ${region} ${city}`.trim();

            /*
             * 3. 悄悄写入 D1 数据库
             * page 列是后加的：老表没有这一列时 INSERT 会报错，
             * 这里自动退回四列写入，保证埋点不会因为表结构而整条失败。
             */
            /*
             * 三级降级写入：表结构是逐步加列的，老表少列时不能让埋点整条失败。
             *   ① 全字段（含 page / device_id / model 等）
             *   ② 基础字段 + page
             *   ③ 只有最开始那四列
             */
            try {
                await DB.prepare(
                    "INSERT INTO site_visits (" +
                    "device, browser, ip, location, page, device_id, fingerprint, model, " +
                    "platform, gpu, screen, cores, memory, network, tz, referrer" +
                    ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
                )
                    .bind(
                        device, browser, ip, location, pageName,
                        deviceId, fingerprint, model, platform, gpu, screenInfo,
                        cores, memory, network, tz, referrer
                    )
                    .run();
            } catch (fullErr) {
                try {
                    await DB.prepare(
                        "INSERT INTO site_visits (device, browser, ip, location, page) VALUES (?, ?, ?, ?, ?)"
                    )
                        .bind(device, browser, ip, location, pageName)
                        .run();
                } catch (pageErr) {
                    await DB.prepare(
                        "INSERT INTO site_visits (device, browser, ip, location) VALUES (?, ?, ?, ?)"
                    )
                        .bind(device, browser, ip, location)
                        .run();
                }
            }

            return new Response(JSON.stringify({ success: true }), {
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
            });
        } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), { status: 500 });
        }
    }
    return new Response("Method Not Allowed", { status: 405 });
}
