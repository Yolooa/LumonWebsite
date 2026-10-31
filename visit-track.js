(() => {
  "use strict";

  const DEVICE_KEY = "lumon.visit.device.v1";
  const FINGERPRINT_KEY = "lumon.visit.fingerprint.v1";

  function storageGet(key) {
    try {
      return localStorage.getItem(key) || "";
    } catch {
      return "";
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Tracking must never interrupt the page.
    }
  }

  function randomId() {
    if (crypto?.randomUUID) return `dev_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
    return `dev_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }

  function deviceId() {
    let id = storageGet(DEVICE_KEY);
    if (!id) {
      id = randomId();
      storageSet(DEVICE_KEY, id);
    }
    return id;
  }

  function hash(value) {
    let result = 5381;
    for (let index = 0; index < value.length; index += 1) {
      result = ((result * 33) ^ value.charCodeAt(index)) >>> 0;
    }
    return `fp_${result.toString(16).padStart(8, "0")}`;
  }

  function browserName() {
    const ua = navigator.userAgent || "";
    if (/Edg\//.test(ua)) return "Edge";
    if (/OPR\/|Opera/.test(ua)) return "Opera";
    if (/Firefox\//.test(ua)) return "Firefox";
    if (/Chrome\//.test(ua)) return "Chrome";
    if (/Safari\//.test(ua)) return "Safari";
    return "其它";
  }

  function gpuName() {
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      if (!gl) return "";
      const extension = gl.getExtension("WEBGL_debug_renderer_info");
      return String(extractGpu(gl, extension) || "").slice(0, 80);
    } catch {
      return "";
    }
  }

  function extractGpu(gl, extension) {
    return extension
      ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
  }

  function fallbackModel() {
    const ua = navigator.userAgent || "";
    if (/iPhone/.test(ua)) return "iPhone";
    if (/iPad/.test(ua)) return "iPad";
    if (/Macintosh/.test(ua)) return "Mac";
    if (/Windows NT 10/.test(ua)) return "Windows 10/11";
    if (/Windows NT/.test(ua)) return "Windows";
    if (/Android/.test(ua)) return "Android 设备";
    if (/Linux/.test(ua)) return "Linux";
    return "未知";
  }

  async function highEntropy() {
    try {
      return await navigator.userAgentData?.getHighEntropyValues?.([
        "model",
        "platform",
        "platformVersion"
      ]) || {};
    } catch {
      return {};
    }
  }

  async function payload() {
    const extra = await highEntropy();
    const ua = navigator.userAgent || "";
    const platform = [extra.platform || navigator.platform || "", extra.platformVersion || ""]
      .filter(Boolean)
      .join(" ")
      .slice(0, 60);
    const screenValue = screen.width && screen.height
      ? `${screen.width}×${screen.height}@${devicePixelRatio || 1}x`
      : "";
    const gpu = gpuName();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    const network = navigator.connection
      ? [navigator.connection.effectiveType, navigator.connection.downlink ? `${navigator.connection.downlink}Mbps` : ""]
          .filter(Boolean)
          .join(" / ")
      : "";
    const fingerprint = hash([
      ua,
      platform,
      screenValue,
      gpu,
      timezone,
      navigator.hardwareConcurrency || 0,
      navigator.deviceMemory || 0,
      navigator.language || "",
      navigator.maxTouchPoints || 0
    ].join("|"));
    const storedFingerprint = storageGet(FINGERPRINT_KEY) || fingerprint;
    storageSet(FINGERPRINT_KEY, storedFingerprint);
    return {
      device: /Mobi|Android|iPhone|iPad|iPod|HarmonyOS/i.test(ua) ? "移动端" : "电脑端",
      browser: browserName(),
      page: location.pathname.split("/").pop() || "index.html",
      device_id: deviceId(),
      fingerprint: storedFingerprint,
      model: String(extra.model || fallbackModel()).slice(0, 80),
      platform,
      gpu,
      screen: screenValue,
      cores: navigator.hardwareConcurrency || 0,
      memory: navigator.deviceMemory || 0,
      network,
      tz: timezone,
      referrer: String(document.referrer || "").slice(0, 200)
    };
  }

  payload()
    .then((data) => fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      keepalive: true
    }))
    .catch(() => {
      // Analytics must never affect the user experience.
    });
})();
