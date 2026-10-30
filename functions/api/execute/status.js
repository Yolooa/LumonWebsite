import {
  errorResponse,
  json,
  requireMethod,
  requireUser
} from "../_shared.js";

async function probe(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function onRequest(context) {
  try {
    requireMethod(context.request, "GET");
    await requireUser(context);
    const requestUrl = new URL(context.request.url);
    const shouldProbe = requestUrl.searchParams.get("probe") === "1";
    const wandboxUrl = String(context.env.WANDBOX_API_URL || "https://wandbox.org/api")
      .replace(/\/+$/, "");
    const pistonUrl = String(context.env.PISTON_API_URL || "https://emkc.org/api/v2/piston")
      .replace(/\/+$/, "");
    const remote = {
      wandbox: shouldProbe ? await probe(`${wandboxUrl}/list.json`) : null,
      piston: shouldProbe ? await probe(`${pistonUrl}/runtimes`) : null
    };
    return json({
      success: true,
      provider: "cloudflare",
      local: false,
      remote,
      wandboxUrl,
      pistonUrl
    });
  } catch (error) {
    return errorResponse(error);
  }
}
