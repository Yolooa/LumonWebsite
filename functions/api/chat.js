export async function onRequest(context) {
    // 统一步骤：配置全局跨域响应头，防止前端产生网络拦截
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    };

    // 核心拦截：直接响应浏览器的 OPTIONS 预检请求，防止连接被瞬间重置
    if (context.request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
        const { prompt, provider } = await context.request.json();

        // 1. 如果用户选择了 Cloudflare AI 节点
        if (provider === 'cloudflare') {
            if (!context.env.AI) {
                return new Response(JSON.stringify({ answer: "❌ 云端未绑定 Workers AI 实例，请检查后台绑定。" }), { 
                    status: 200, 
                    headers: { ...corsHeaders, 'Content-Type': 'application/json;charset=UTF-8' } 
                });
            }

            // 🚀【这次真的改了】换成目前绝对没过期的 Llama 3.2 3B 核心主力模型
            const activeModel = '@cf/meta/llama-3.2-3b-instruct'; 

            const response = await context.env.AI.run(activeModel, {
                messages: [
                    { role: 'system', content: '你是 Pellosy AI，一个由边缘网络驱动的极简高效率智能助理。' },
                    { role: 'user', content: prompt }
                ]
            });

            // 适配 Cloudflare AI 返回的 response 字段结构
            const replyText = response.response || response.text || "⚠️ 边缘节点未返回有效文本";

            return new Response(JSON.stringify({ answer: replyText }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json;charset=UTF-8' }
            });
        }

        // 2. 如果用户选择了 Gemini 节点
        if (provider === 'gemini') {
            if (!context.env.GEMINI_API_KEY) {
                return new Response(JSON.stringify({ answer: "❌ 云端未检测到 GEMINI_API_KEY 环境变量。" }), { 
                    status: 200, 
                    headers: { ...corsHeaders, 'Content-Type': 'application/json;charset=UTF-8' } 
                });
            }
            
            // 🚀 核心扩充：使用最新的 gemini-2.5-flash 模型请求
            const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${context.env.GEMINI_API_KEY}`;

            const googleResponse = await fetch(geminiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }]
                })
            });

            if (!googleResponse.ok) {
                const errorText = await googleResponse.text();
                throw new Error(`Google API 报错: ${errorText}`);
            }

            const geminiData = await googleResponse.json();
            
            // 精准提取 Gemini 2.5 返回的特定 JSON 文本层级
            let replyText = "⚠️ Gemini 节点未返回有效文本";
            if (geminiData.candidates && geminiData.candidates[0]?.content?.parts[0]?.text) {
                replyText = geminiData.candidates[0].content.parts[0].text;
            }

            return new Response(JSON.stringify({ answer: replyText }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json;charset=UTF-8' }
            });
        }

        // 兜底未知提供商
        return new Response(JSON.stringify({ answer: "❌ 未知的 AI 提供商类型" }), { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json;charset=UTF-8' } 
        });

    } catch (err) {
        // 核心修复：即使执行崩溃进 catch，也要带上 corsHeaders，让前端能抓到具体报错信息
        return new Response(JSON.stringify({ answer: `❌ 边缘内核执行崩溃: ${err.message}` }), { 
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json;charset=UTF-8' }
        });
    }
}
