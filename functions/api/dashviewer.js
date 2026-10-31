const RANGE_MODIFIERS = {
  "24h": "-1 day",
  "7d": "-7 days",
  "30d": "-30 days",
  all: ""
};

function responseJson(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

function requirePassword(request, env) {
  const password = String(env.DASHBOARD_PASSWORD || "");
  if (!password) {
    return {
      response: responseJson({
        success: false,
        code: "NO_PASSWORD_CONFIGURED",
        message: "服务端未配置 DASHBOARD_PASSWORD"
      }, 500)
    };
  }
  const token = String(request.headers.get("X-Dashboard-Token") || "");
  if (token !== password) {
    return {
      response: responseJson({
        success: false,
        code: "BAD_PASSWORD",
        message: "访问口令不正确"
      }, 401)
    };
  }
  return null;
}

function safeColumn(columns, name) {
  return columns.has(name) ? name : "";
}

function groupExpression(columns, name) {
  if (!columns.has(name)) return "";
  return `CASE WHEN ${name} IS NULL OR ${name} = '' THEN '未知' ELSE ${name} END`;
}

async function groupBy(db, whereSql, bindings, columns, field) {
  const expression = groupExpression(columns, field);
  if (!expression) return [];
  try {
    const result = await db.prepare(
      `SELECT ${expression} AS name, COUNT(*) AS count
       FROM site_visits
       ${whereSql}
       GROUP BY name
       ORDER BY count DESC
       LIMIT 20`
    ).bind(...bindings).all();
    return (result.results || []).map((row) => ({
      name: String(row.name || "未知"),
      count: Number(row.count || 0)
    }));
  } catch {
    return [];
  }
}

export async function onRequest(context) {
  if (context.request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "X-Dashboard-Token"
      }
    });
  }

  if (context.request.method !== "GET") {
    return responseJson({ success: false, message: "Method Not Allowed" }, 405);
  }

  const denied = requirePassword(context.request, context.env);
  if (denied) return denied.response;

  const db = context.env.DB;
  if (!db) {
    return responseJson({
      success: false,
      code: "NO_DB_BOUND",
      message: "服务端未绑定 D1 数据库（变量名 DB）"
    }, 500);
  }

  try {
    const table = await db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'site_visits' LIMIT 1"
    ).first();
    if (!table) {
      return responseJson({
        success: false,
        code: "SITE_VISITS_MISSING",
        message: "D1 中不存在 site_visits 表，请执行最终数据库迁移"
      }, 500);
    }

    const url = new URL(context.request.url);
    const requestedRange = String(url.searchParams.get("range") || "7d");
    const range = Object.prototype.hasOwnProperty.call(RANGE_MODIFIERS, requestedRange)
      ? requestedRange
      : "7d";
    const info = await db.prepare("PRAGMA table_info(site_visits)").all();
    const columns = new Set((info.results || []).map((row) => String(row.name)));
    const hasTime = columns.has("visit_time");
    const modifier = hasTime ? RANGE_MODIFIERS[range] : "";
    const whereSql = modifier ? "WHERE datetime(visit_time) >= datetime('now', ?)" : "";
    const bindings = modifier ? [modifier] : [];

    const visitorExpression = columns.has("fingerprint")
      ? "COALESCE(NULLIF(fingerprint, ''), NULLIF(device_id, ''), NULLIF(ip, ''), 'unknown')"
      : columns.has("device_id")
        ? "COALESCE(NULLIF(device_id, ''), NULLIF(ip, ''), 'unknown')"
        : "COALESCE(NULLIF(ip, ''), 'unknown')";
    const ipExpression = columns.has("ip") ? "NULLIF(ip, '')" : "'unknown'";
    const pageExpression = columns.has("page") ? "NULLIF(page, '')" : "'unknown'";

    const summaryResult = await db.prepare(
      `SELECT
         COUNT(*) AS visits,
         COUNT(DISTINCT ${visitorExpression}) AS visitors,
         COUNT(DISTINCT ${ipExpression}) AS unique_ips,
         COUNT(DISTINCT ${pageExpression}) AS unique_pages
       FROM site_visits
       ${whereSql}`
    ).bind(...bindings).first();

    let todayResult = {};
    let hourResult = {};
    if (hasTime) {
      todayResult = await db.prepare(
        `SELECT
           SUM(CASE WHEN date(visit_time) = date('now') THEN 1 ELSE 0 END) AS visits_today,
           SUM(CASE WHEN datetime(visit_time) >= datetime('now', '-1 hour') THEN 1 ELSE 0 END) AS visits_hour
         FROM site_visits`
      ).first();
      hourResult = await db.prepare(
        `SELECT strftime('%Y-%m-%d %H:00', visit_time) AS bucket, COUNT(*) AS count
         FROM site_visits
         WHERE datetime(visit_time) >= datetime('now', '-24 hours')
         GROUP BY bucket
         ORDER BY bucket ASC`
      ).all();
    }

    const bucketFormat = range === "24h" ? "%Y-%m-%d %H:00" : "%Y-%m-%d";
    let series = [];
    if (hasTime) {
      const seriesResult = await db.prepare(
        `SELECT strftime('${bucketFormat}', visit_time) AS bucket, COUNT(*) AS count
         FROM site_visits
         ${whereSql}
         GROUP BY bucket
         ORDER BY bucket ASC`
      ).bind(...bindings).all();
      series = (seriesResult.results || []).map((row) => ({
        bucket: String(row.bucket || ""),
        count: Number(row.count || 0)
      }));
    }

    const fields = [
      "page",
      "browser",
      "device",
      "platform",
      "network",
      "location",
      "referrer",
      "screen",
      "model",
      "tz",
      "gpu"
    ];
    const groups = {};
    for (const field of fields) {
      groups[field] = await groupBy(db, whereSql, bindings, columns, field);
    }

    const orderSql = hasTime ? "ORDER BY visit_time DESC" : "ORDER BY rowid DESC";
    const recentResult = await db.prepare(
      `SELECT * FROM site_visits ${orderSql} LIMIT 500`
    ).all();

    const visits = Number(summaryResult?.visits || 0);
    const visitors = Number(summaryResult?.visitors || 0);
    return responseJson({
      success: true,
      generatedAt: new Date().toISOString(),
      range,
      rangeApplied: Boolean(modifier),
      columns: [...columns],
      summary: {
        visits,
        visitors,
        uniqueIps: Number(summaryResult?.unique_ips || 0),
        uniquePages: Number(summaryResult?.unique_pages || 0),
        averageVisitsPerVisitor: visitors ? Number((visits / visitors).toFixed(2)) : 0,
        visitsToday: Number(todayResult?.visits_today || 0),
        visitsLastHour: Number(todayResult?.visits_hour || 0)
      },
      series,
      hourly: (hourResult.results || []).map((row) => ({
        bucket: String(row.bucket || ""),
        count: Number(row.count || 0)
      })),
      groups,
      recent: (recentResult.results || []).map((row) => ({ ...row }))
    });
  } catch (error) {
    return responseJson({
      success: false,
      code: "DASHVIEWER_QUERY_FAILED",
      message: String(error.message || error)
    }, 500);
  }
}
