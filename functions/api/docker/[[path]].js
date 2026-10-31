const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

export async function onRequest(context) {
  const path = Array.isArray(context.params?.path)
    ? String(context.params.path[0] || "")
    : String(context.params?.path || "");

  if (path === "status" && context.request.method === "GET") {
    return new Response(JSON.stringify({
      success: true,
      available: false,
      message: "Cloudflare 无法访问本机 Docker。请通过本地 server-local.mjs 打开首页使用 Docker 面板。"
    }), { headers });
  }

  if (path === "action" && context.request.method === "POST") {
    return new Response(JSON.stringify({
      success: false,
      code: "LOCAL_DOCKER_ONLY",
      message: "Docker 操作仅支持本地运行环境"
    }), { status: 501, headers });
  }

  return new Response(JSON.stringify({
    success: false,
    code: "NOT_FOUND",
    message: "Docker 路由不存在"
  }), { status: 404, headers });
}
