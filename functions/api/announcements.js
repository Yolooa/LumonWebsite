function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

function authorized(request, env) {
  return Boolean(env.DASHBOARD_PASSWORD)
    && String(request.headers.get("X-Dashboard-Token") || "") === String(env.DASHBOARD_PASSWORD);
}

function clean(value, max) {
  return String(value || "").trim().slice(0, max);
}

export async function onRequest(context) {
  if (context.request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Dashboard-Token"
      }
    });
  }

  const db = context.env.DB;
  if (!db) {
    return json({
      success: false,
      code: "NO_DB_BOUND",
      message: "服务端未绑定 D1 数据库"
    }, 500);
  }

  try {
    if (context.request.method === "GET") {
      const result = await db.prepare(
        `SELECT id, title, summary, content, category, pinned, created_at, updated_at
         FROM announcements
         WHERE published = 1
         ORDER BY pinned DESC, created_at DESC
         LIMIT 100`
      ).all();
      return json({
        success: true,
        announcements: (result.results || []).map((item) => ({
          ...item,
          pinned: Boolean(item.pinned)
        }))
      });
    }

    if (!authorized(context.request, context.env)) {
      return json({
        success: false,
        code: "BAD_PASSWORD",
        message: "管理口令不正确"
      }, 401);
    }

    if (context.request.method === "POST") {
      const body = await context.request.json().catch(() => ({}));
      const title = clean(body.title, 140);
      const summary = clean(body.summary, 240);
      const content = clean(body.content, 12000);
      const category = clean(body.category || "公告", 32);
      if (!title || !content) {
        return json({
          success: false,
          code: "BAD_REQUEST",
          message: "公告标题和正文不能为空"
        }, 400);
      }
      const id = `announcement_${crypto.randomUUID()}`;
      await db.prepare(
        `INSERT INTO announcements
         (id, title, summary, content, category, pinned, published)
         VALUES (?, ?, ?, ?, ?, ?, 1)`
      ).bind(
        id,
        title,
        summary,
        content,
        category,
        body.pinned ? 1 : 0
      ).run();
      return json({
        success: true,
        announcement: {
          id,
          title,
          summary,
          content,
          category,
          pinned: Boolean(body.pinned),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      }, 201);
    }

    if (context.request.method === "DELETE") {
      const id = clean(new URL(context.request.url).searchParams.get("id"), 120);
      if (!id) {
        return json({ success: false, message: "缺少公告 ID" }, 400);
      }
      await db.prepare("DELETE FROM announcements WHERE id = ?").bind(id).run();
      return json({ success: true });
    }

    return json({ success: false, message: "Method Not Allowed" }, 405);
  } catch (error) {
    return json({
      success: false,
      code: "ANNOUNCEMENT_QUERY_FAILED",
      message: String(error.message || error)
    }, 500);
  }
}
