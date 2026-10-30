/**
 * functions/api/music.js — ArcX Music 网页版的同源代理
 *
 * 为什么需要它：QQ音乐 / 网易云 / B站的搜索、歌词、取流接口**都没有 CORS 头**，
 * 浏览器无法直接调用（实测 ACAO 为空）。音频 CDN 虽然有 CORS，但播放地址
 * 仍要靠这些接口解析。因此统一在本函数内转发，并把结果整理成前端要的形状。
 *
 * 路由：/api/music?src=<qq|netease|bili|kugou>&act=<search|hot|lyric|url>&...
 * 说明：Cloudflare Pages Functions 支持任意深度的 [path].js，
 *       因此这里用 query 区分音源与动作，避免再建一层目录。
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Range",
  "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges"
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json;charset=UTF-8" }
  });

const fail = (message, status = 200) => json({ ok: false, error: message }, status);

const toNum = (v, fallback = 0) => {
  const n = Number(v);

  return Number.isFinite(n) ? n : fallback;
};

const fmtDuration = (seconds) => {
  const s = Math.max(0, Math.round(toNum(seconds)));

  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

async function fetchJson(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      "User-Agent": UA,
      Accept: "application/json, text/plain, */*",
      ...(init.headers || {})
    }
  });
  const text = await res.text();

  if (!res.ok) {
    // 带上响应体片段：有些站点用 200/412 返回 HTML 错误页，看不到就没法排查
    throw new Error(
      `上游 HTTP ${res.status} ${res.headers.get("content-type") || ""} | ${text
        .replace(/\s+/g, " ")
        .slice(0, 120)}`
    );
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start < 0 || end <= start) {
    throw new Error(`上游非 JSON：${text.replace(/\s+/g, " ").slice(0, 120)}`);
  }

  return JSON.parse(text.slice(start, end + 1));
}

/* ==========================================================================
   QQ 音乐
   ========================================================================== */

const QQ_HEADERS = { Referer: "https://y.qq.com/" };

const qqSearchModern = async (keyword, limit) => {
  const data = await fetchJson("https://u.y.qq.com/cgi-bin/musicu.fcg", {
    method: "POST",
    headers: { ...QQ_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({
      comm: { ct: "19", cv: "1859", uin: "0", format: "json" },
      req: {
        module: "music.search.SearchCgiService",
        method: "DoSearchForQQMusicDesktop",
        param: { num_per_page: String(limit), page_num: "1", query: keyword, search_type: "0" }
      }
    })
  });

  const list = data?.req?.data?.body?.song?.list ?? [];

  return list.map((s) => ({
    id: s.mid ?? "",
    name: s.name ?? "未知歌曲",
    artist: (s.singer || []).map((x) => x.name).filter(Boolean).join(" / ") || "未知歌手",
    album: s.album?.name ?? "",
    cover: s.album?.mid
      ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${s.album.mid}.jpg`
      : "",
    duration: toNum(s.interval),
    source: "qq"
  }));
};

const qqSearchLegacy = async (keyword, limit) => {
  const qs = new URLSearchParams({
    w: keyword, format: "json", n: String(limit), p: "1", t: "0", aggr: "1",
    cr: "1", catZhida: "1", lossless: "0", flag_qc: "0",
    remoteplace: "txt.yqq.song", g_tk: "5381", loginUin: "0", hostUin: "0",
    inCharset: "utf8", outCharset: "utf-8", notice: "0",
    platform: "yqq.json", needNewCode: "0"
  });

  const data = await fetchJson(
    `https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp?${qs}`,
    { headers: QQ_HEADERS }
  );

  const list = data?.data?.song?.list ?? [];

  return list.map((s) => ({
    id: s.songmid ?? "",
    name: s.songname ?? "未知歌曲",
    artist: (s.singer || []).map((x) => x.name).filter(Boolean).join(" / ") || "未知歌手",
    album: s.albumname ?? "",
    cover: s.albummid
      ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${s.albummid}.jpg`
      : "",
    duration: toNum(s.interval),
    source: "qq"
  }));
};

/* 两个入口都试，谁先出结果用谁（顺序与客户端一致：新接口优先） */
const qqSearch = async (keyword, limit) => {
  const attempts = [qqSearchModern, qqSearchLegacy];

  for (const fn of attempts) {
    try {
      const list = await fn(keyword, limit);

      if (list.length) {
        return list.filter((s) => s.id);
      }
    } catch {
      /* 换下一个入口 */
    }
  }

  return [];
};

const qqHot = async (limit) => {
  const qs = new URLSearchParams({
    topid: "4", format: "json", inCharset: "utf8", outCharset: "utf-8",
    notice: "0", platform: "yqq.json", needNewCode: "0"
  });

  const data = await fetchJson(
    `https://c.y.qq.com/v8/fcg-bin/fcg_v8_toplist_cp.fcg?${qs}`,
    { headers: QQ_HEADERS }
  );

  // 注意：歌曲数组在顶层 songlist（新版），不在 data.songlist
  const list = data?.songlist ?? data?.data?.songlist ?? [];

  return list.slice(0, limit).map((raw) => {
    const s = raw?.data ?? raw;
    const albumMid = s.albummid ?? s.album?.mid ?? "";

    return {
      id: s.songmid ?? s.mid ?? "",
      name: s.songname ?? s.name ?? "未知歌曲",
      artist: (s.singer || []).map((x) => x.name).filter(Boolean).join(" / ") || "未知歌手",
      album: s.albumname ?? s.album?.name ?? "",
      cover: albumMid
        ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg`
        : "",
      duration: toNum(s.interval),
      source: "qq"
    };
  }).filter((s) => s.id);
};

/**
 * 取播放地址。
 *
 * 难点：搜索出来的热门曲常常是 VIP/付费版（vkey 返回 result=104003、purl 空），
 * 但同一首歌的其它版本（现场版 / Demo / 翻唱）往往是免费的。
 * 因此这里接收**候选 mid 列表**（前端传当前曲目及其同名版本），一次批量解析，
 * 返回第一个真正拿得到 purl 的版本。批量是一个请求，不会放大往返。
 */
const qqUrl = async (mid, candidates) => {
  const list = [mid, ...(Array.isArray(candidates) ? candidates : [])]
    .filter(Boolean)
    .filter((m, i, a) => a.indexOf(m) === i)
    .slice(0, 12);

  const data = await fetchJson("https://u.y.qq.com/cgi-bin/musicu.fcg", {
    method: "POST",
    headers: { ...QQ_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({
      comm: { uin: "0", format: "json", ct: "24", cv: "0" },
      req_0: {
        module: "vkey.GetVkeyServer",
        method: "CgiGetVkey",
        param: {
          guid: "12345678901234567890123456789012",
          songmid: list,
          songtype: list.map(() => 0),
          uin: "0",
          loginflag: 1,
          platform: "20"
        }
      }
    })
  });

  const info = data?.req_0?.data ?? {};
  const sips = (info.sip || []).filter((s) => typeof s === "string");
  let host = "https://ws.stream.qqmusic.qq.com/";

  if (sips.length) {
    let candidate = sips.find((s) => s.startsWith("https")) || sips[0];

    if (candidate.startsWith("http://")) {
      candidate = `https://${candidate.slice(7)}`;
    }

    if (candidate && !candidate.endsWith("/")) {
      candidate += "/";
    }

    if (candidate) {
      host = candidate;
    }
  }

  const items = info.midurlinfo || [];
  let vipBlocked = 0;

  for (const item of items) {
    const purl = item.purl ?? "";

    if (purl) {
      // 用「实际命中的 mid」拼地址，可能与请求的第一首不同
      return {
        url: purl.startsWith("http") ? purl : host + purl,
        matchedId: item.songmid || mid,
        reason: ""
      };
    }

    if (item.result === 104003) {
      vipBlocked += 1;
    }
  }

  return {
    url: "",
    matchedId: "",
    reason: vipBlocked === list.length && list.length > 1
      ? "该曲及其它版本均为 VIP/付费"
      : "该曲为 VIP/付费，且未找到免费版本"
  };
};

const qqLyric = async (mid) => {
  const qs = new URLSearchParams({ songmid: mid, format: "json", nobase64: "1" });
  const data = await fetchJson(
    `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?${qs}`,
    { headers: QQ_HEADERS }
  );

  return { lrc: data?.lyric ?? "", trans: data?.trans ?? "" };
};

/* ==========================================================================
   网易云
   ========================================================================== */

const NETEASE_HEADERS = { Referer: "https://music.163.com/" };

const neteaseSearch = async (keyword, limit) => {
  const qs = new URLSearchParams({ s: keyword, type: "1", limit: String(limit), offset: "0" });
  const data = await fetchJson(
    `https://music.163.com/api/search/get/web?${qs}`,
    { headers: NETEASE_HEADERS }
  );

  return (data?.result?.songs ?? []).map((s) => ({
    id: String(s.id),
    name: s.name ?? "未知歌曲",
    artist: (s.artists || s.ar || []).map((x) => x.name).filter(Boolean).join(" / ") || "未知歌手",
    album: s.album?.name ?? s.al?.name ?? "",
    cover: s.album?.picUrl ?? s.al?.picUrl ?? "",
    duration: Math.round(toNum(s.duration) / 1000),
    source: "netease"
  }));
};

const neteaseHot = async (limit) => {
  const data = await fetchJson(
    "https://music.163.com/api/playlist/detail?id=3778678",
    { headers: NETEASE_HEADERS }
  );

  return (data?.result?.tracks ?? []).slice(0, limit).map((s) => ({
    id: String(s.id),
    name: s.name ?? "未知歌曲",
    artist: (s.artists || []).map((x) => x.name).filter(Boolean).join(" / ") || "未知歌手",
    album: s.album?.name ?? "",
    cover: s.album?.picUrl ?? "",
    duration: Math.round(toNum(s.duration) / 1000),
    source: "netease"
  }));
};

const neteaseUrl = async (id) => {
  const data = await fetchJson(
    `https://music.163.com/api/song/enhance/player/url?id=${id}&ids=%5B${id}%5D&br=320000`,
    { headers: NETEASE_HEADERS }
  );
  const url = (data?.data || [])[0]?.url ?? "";

  return url
    ? { url, reason: "" }
    : { url: "", reason: "该曲需登录或无版权" };
};

const neteaseLyric = async (id) => {
  const data = await fetchJson(
    `https://music.163.com/api/song/lyric?id=${id}&lv=1&kv=1&tv=-1`,
    { headers: NETEASE_HEADERS }
  );

  return { lrc: data?.lrc?.lyric ?? "", trans: data?.tlyric?.lyric ?? "" };
};

/* ==========================================================================
   B 站（音频流）
   注意：B 站搜索接口**必须有 Referer**，只带 UA 会被风控返回 HTTP 412。
   ========================================================================== */

const BILI_HEADERS = {
  Referer: "https://www.bilibili.com/",
  Origin: "https://www.bilibili.com",
  "Accept-Language": "zh-CN,zh;q=0.9"
};

const biliSearch = async (keyword, limit) => {
  const qs = new URLSearchParams({ search_type: "video", keyword, page: "1" });
  const data = await fetchJson(
    `https://api.bilibili.com/x/web-interface/search/type?${qs}`,
    { headers: BILI_HEADERS }
  );

  if (data?.code !== 0) {
    throw new Error(`B站返回 code=${data?.code} ${data?.message ?? ""}`);
  }

  const strip = (html) => String(html ?? "").replace(/<[^>]+>/g, "");

  return (data?.data?.result ?? []).slice(0, limit).map((v) => ({
    id: v.bvid ?? "",
    name: strip(v.title),
    artist: strip(v.author) || "B 站",
    album: "B 站视频音轨",
    cover: v.pic ? (v.pic.startsWith("//") ? `https:${v.pic}` : v.pic) : "",
    duration: v.duration ?? "",
    source: "bili",
    isVideo: true
  })).filter((v) => v.id);
};

const biliHot = async (limit) => biliSearch("热门歌曲", limit);

/** 取 B 站音频流：view 拿 cid → playurl 拿 dash.audio */
const biliUrl = async (bvid) => {
  const view = await fetchJson(
    `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
    { headers: BILI_HEADERS }
  );
  const cid = view?.data?.cid;

  if (!cid) {
    throw new Error("无法获取视频 cid");
  }

  const play = await fetchJson(
    `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&fnval=16`,
    { headers: { ...BILI_HEADERS, Referer: `https://www.bilibili.com/video/${bvid}` } }
  );
  const audio = play?.data?.dash?.audio?.[0];

  if (!audio?.baseUrl) {
    throw new Error(`无音频流（code ${play?.code}）`);
  }

  // B 站音频流需要 Referer 才能取字节，因此交给本站代理转发
  return {
    url: `/api/music?src=bili&act=stream&id=${encodeURIComponent(bvid)}`,
    direct: audio.baseUrl,
    proxied: true,
    reason: ""
  };
};

/**
 * B 站音频流转发。
 * 音频 CDN 校验 Referer，浏览器直接播会 403；这里带回 Referer 取流并透传 Range，
 * 保证 <audio> 能拖动进度（206）。
 */
const biliStream = async (bvid, context) => {
  const out = await biliUrl(bvid);
  const range = context?.request?.headers?.get("range") || "";

  const upstream = await fetch(out.direct, {
    headers: {
      "User-Agent": UA,
      Referer: `https://www.bilibili.com/video/${bvid}`,
      ...(range ? { Range: range } : {})
    }
  });

  if (!upstream.ok && upstream.status !== 206) {
    throw new Error(`音频流 HTTP ${upstream.status}`);
  }

  const headers = new Headers(CORS);

  headers.set("Content-Type", upstream.headers.get("content-type") || "audio/mp4");
  headers.set("Accept-Ranges", "bytes");

  ["content-length", "content-range"].forEach((k) => {
    const v = upstream.headers.get(k);

    if (v) {
      headers.set(k, v);
    }
  });

  return new Response(upstream.body, { status: upstream.status, headers });
};

/* ==========================================================================
   路由
   ========================================================================== */

const HANDLERS = {
  qq: { search: qqSearch, hot: qqHot, url: qqUrl, lyric: qqLyric },
  netease: { search: neteaseSearch, hot: neteaseHot, url: neteaseUrl, lyric: neteaseLyric },
  bili: { search: biliSearch, hot: biliHot, url: biliUrl }
};

export async function onRequest(context) {
  const { request } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const url = new URL(request.url);
  const src = (url.searchParams.get("src") || "qq").toLowerCase();
  const act = (url.searchParams.get("act") || "hot").toLowerCase();
  const keyword = url.searchParams.get("q") || "";
  const id = url.searchParams.get("id") || "";
  const limit = Math.min(Math.max(toNum(url.searchParams.get("limit"), 20), 1), 50);

  const pack = HANDLERS[src];

  if (!pack) {
    return fail(`未知音源：${src}`);
  }

  /* B 站音频流转发：直接回 Response（音频字节），不包 JSON */
  if (src === "bili" && act === "stream") {
    if (!id) {
      return fail("缺少参数 id");
    }

    try {
      return await biliStream(id, context);
    } catch (error) {
      return fail(String(error?.message || error).slice(0, 200));
    }
  }

  const fn = pack[act];

  if (!fn) {
    return fail(`音源 ${src} 不支持动作 ${act}`);
  }

  try {
    let payload;

    // url 动作用 (id, candidates)：候选来自同名前若干首，用于跳过 VIP 版
    if (act === "url") {
      if (!id) {
        return fail("缺少参数 id");
      }

      const candidates = (url.searchParams.get("cands") || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      payload = await fn(id, candidates);
    } else if (act === "search" || act === "hot") {
      /*
       * 必须用括号把三元的两个分支整体包起来。
       * 写成 `await act === "search" ? a() : b()` 时，await 的优先级更高，
       * 会被解析成 `(await act === "search") ? a() : b()` ——
       * await 落在布尔比较上，返回的是**没被 await 的 Promise**，
       * 序列化后就成了 {}，前端拿到空数据。
       */
      payload = await (act === "search" ? fn(keyword, limit) : fn(limit));
    } else {
      if (!id) {
        return fail("缺少参数 id");
      }

      payload = await fn(id);
    }

    return json({ ok: true, src, act, data: payload });
  } catch (error) {
    // 上游失败也返回 200 + ok:false，方便前端做多源回退
    return fail(String(error?.message || error).slice(0, 200));
  }
}
