// /functions/api/posts.js
// Cloudflare Pages Functions 全栈引擎（已适配全新变量名 SOCIAL_DB）

// 1. 处理前端获取所有帖子的请求 (GET)
export async function onRequestGet(context) {
    const { env } = context;
    
    // 🚨 安全拦截：检查全新绑定的 SOCIAL_DB
    if (!env.SOCIAL_DB) {
        return new Response(JSON.stringify([
            { username: "System@Lumon", content: "⚡ Cloudflare 全栈 Function 环境已就绪！请前往 Dashboard 绑定 KV 命名空间 'SOCIAL_DB' 激活持久化存储。", timestamp: Date.now() }
        ]), { headers: { "Content-Type": "application/json" } });
    }

    // 从全新的 SOCIAL_DB 极速读取动态流
    const rawData = await env.SOCIAL_DB.get("timeline_posts");
    const posts = rawData ? JSON.parse(rawData) : [];
    
    return new Response(JSON.stringify(posts), {
        headers: { 
            "Content-Type": "application/json;charset=UTF-8",
            "Cache-Control": "no-cache"
        }
    });
}

// 2. 处理前端发帖的请求 (POST)
export async function onRequestPost(context) {
    const { request, env } = context;
    
    // 🚨 安全拦截：检查全新绑定的 SOCIAL_DB
    if (!env.SOCIAL_DB) {
        return new Response(JSON.stringify({ error: "KV 未绑定" }), { status: 500 });
    }

    try {
        const { username, content } = await request.json();
        
        if (!username || !content) {
            return new Response(JSON.stringify({ error: "字段不全" }), { status: 400 });
        }

        // 构造新帖子结构
        const newPost = {
            username: username,
            content: content,
            timestamp: Date.now()
        };

        // 获取并追加到旧队列头部
        const rawData = await env.SOCIAL_DB.get("timeline_posts");
        let posts = rawData ? JSON.parse(rawData) : [];
        
        posts.unshift(newPost); // 最新发的排最上面
        if (posts.length > 100) posts = posts.slice(0, 100); // 限制存储最后100条

        // 写入全新绑定的云端 KV 数据库
        await env.SOCIAL_DB.put("timeline_posts", JSON.stringify(posts));

        return new Response(JSON.stringify({ status: "success" }), {
            headers: { "Content-Type": "application/json" }
        });
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
}
