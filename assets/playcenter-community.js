(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const play = window.LumonPlay;
  if (!play) return;
  const MAX_BYTES = 1024 * 1024;
  const categories = { puzzle: "益智解谜", arcade: "街机动作", reaction: "反应挑战", other: "其他创意" };
  const catalog = new Map();
  let viewer = null;
  let nextOffset = null;
  let loading = false;
  let uploadBusy = false;
  let editing = null;
  let chosenFile = null;
  let chosenHtml = "";
  let fileRevision = 0;
  let editorRevision = 0;
  const uploadDialog = $("#uploadDialog");
  const previewDialog = $("#previewDialog");

  async function api(path, { signal, ...options } = {}) {
    const controller = new AbortController();
    const stop = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener("abort", stop, { once: true });
    const timer = setTimeout(stop, 20000);
    try {
      const response = await fetch(`/api${path}`, { credentials: "same-origin", cache: "no-store", ...options, signal: controller.signal });
      const type = response.headers.get("Content-Type") || "";
      if (!type.includes("application/json")) {
        throw new Error("游戏上传接口尚未部署，请将 functions/api/games 一起部署到 Cloudflare。");
      }
      const data = await response.json();
      if (!response.ok || data.success === false) {
        const error = new Error(data.message || `请求失败 (${response.status})`);
        error.status = response.status;
        throw error;
      }
      return data;
    } catch (error) {
      if (error.name === "AbortError" && !signal?.aborted) throw new Error("请求超时，请检查网络后重试。");
      throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", stop); }
  }

  function frameFor(html, title) {
    const frame = document.createElement("iframe");
    frame.className = "community-frame";
    frame.title = title;
    // Never add allow-same-origin: an uploaded game must not access site data.
    frame.setAttribute("sandbox", "allow-scripts allow-pointer-lock");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.setAttribute("allow", "camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'; usb 'none'");
    const policy = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob: data:; style-src 'unsafe-inline' blob: data:; img-src blob: data:; media-src blob: data:; font-src blob: data:; connect-src 'none'; worker-src blob:; child-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
    frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html{color-scheme:light}body{margin:0}canvas{max-width:100%}</style><script>addEventListener('keydown',function(e){if(e.key==='Escape'){e.preventDefault();parent.postMessage('lumon-play:escape','*')}},true)</script></head><body>${html}</body></html>`;
    return frame;
  }

  function createPlayer(game) {
    const stage = $("#gameStage");
    const controller = new AbortController();
    let frame; let source = ""; let alive = true;
    const loading = document.createElement("div"); loading.className = "community-game-loading";
    const text = document.createElement("p"); text.textContent = "正在接通这份创作…";
    loading.append(text); stage.append(loading);
    const meta = $("#gameMessage"); meta.textContent = `作者：${game.author} · ${game.visibility === "private" ? "仅自己可见" : "公开作品"}`;
    function mount() {
      if (!alive || !source) return;
      frame?.remove();
      frame = frameFor(source, game.title);
      stage.replaceChildren(frame);
      frame.addEventListener("load", () => { if (alive) frame.focus({ preventScroll: true }); }, { once: true });
    }
    async function load() {
      try {
        const data = await api(`/games/${encodeURIComponent(game.id)}`, { signal: controller.signal });
        if (!alive) return;
        source = data.game.html;
        mount();
      } catch (error) {
        if (!alive) return;
        text.textContent = error.message || "游戏加载失败。";
        const retry = document.createElement("button"); retry.className = "text-button"; retry.textContent = "重新载入 ↗";
        retry.addEventListener("click", () => { stage.replaceChildren(loading); retry.remove(); void load(); });
        loading.append(retry);
      }
    }
    void load();
    return { restart() { source ? mount() : void load(); }, focus() { frame?.focus({ preventScroll: true }); },
      destroy() { alive = false; controller.abort(); frame?.remove(); source = ""; } };
  }
  window.LumonCommunity = { createPlayer };
  window.addEventListener("message", (event) => {
    if (event.data !== "lumon-play:escape") return;
    const frame = [...document.querySelectorAll("iframe.community-frame")].find((item) => item.contentWindow === event.source);
    if (!frame) return;
    if (previewDialog.contains(frame) && previewDialog.open) previewDialog.close();
    else if ($("#gameDialog").contains(frame) && $("#gameDialog").open) $("#gameDialog").close();
  });

  function makeCard(game) {
    const card = document.createElement("article");
    card.className = "game-card community-card";
    card.dataset.game = game.id;
    card.dataset.community = "true";
    card.dataset.owned = String(game.mine);
    card.dataset.category = game.category;
    card.dataset.search = `${game.title} ${game.summary} ${game.author} ${game.username} ${categories[game.category]} 创作 社区`;
    card.dataset.cover = game.color;
    const favorite = document.createElement("button");
    favorite.className = "favorite-button"; favorite.dataset.favorite = game.id;
    favorite.setAttribute("aria-label", `收藏 ${game.title}`); favorite.setAttribute("aria-pressed", "false");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use"); use.setAttribute("href", "#p-star"); svg.append(use); favorite.append(svg);
    const launch = document.createElement("button"); launch.className = "game-launch"; launch.dataset.launch = game.id;
    launch.setAttribute("aria-label", `开始玩 ${game.title}`);
    const art = document.createElement("div"); art.className = "community-art"; art.setAttribute("aria-hidden", "true");
    const label = document.createElement("span"); label.className = "mini-index";
    label.textContent = game.visibility === "private" ? "PRIVATE / 我的作品" : "COMMUNITY / 作者创作";
    const letter = document.createElement("strong"); letter.textContent = [...game.title][0] || "✦";
    const orbit = document.createElement("span"); orbit.className = "creator-orbit"; orbit.textContent = "✳";
    art.append(label, letter, orbit);
    const info = document.createElement("div"); info.className = "community-card-copy";
    const title = document.createElement("h2"); title.textContent = game.title; title.title = game.title;
    const description = document.createElement("p"); description.textContent = game.summary || "一份新的灵感，等你来探索。";
    const author = document.createElement("span"); author.className = "creator-name"; author.textContent = `by ${game.author}`; author.title = game.author;
    const tag = document.createElement("small"); tag.textContent = `${categories[game.category] || "其他创意"} · ${Math.ceil(game.bytes / 1024)} KiB`;
    info.append(title, description, author, tag); launch.append(art, info);
    card.append(favorite, launch);
    if (game.mine) {
      const manage = document.createElement("button"); manage.className = "manage-game"; manage.textContent = "管理作品 ↗";
      manage.addEventListener("click", () => void showEditor(game)); card.append(manage);
    }
    return card;
  }

  function addGames(items) {
    const valid = items.filter((game) => game && /^game_[a-f0-9-]{36}$/.test(game.id));
    for (const game of valid) {
      catalog.set(game.id, game);
      const oldCard = document.querySelector(`.community-card[data-game="${game.id}"]`);
      const card = makeCard(game);
      if (oldCard) oldCard.replaceWith(card);
      else $("#gameGrid").append(card);
    }
    play.register(valid);
  }

  async function loadCatalog(more = false) {
    if (loading) return;
    loading = true;
    $("#refreshCommunity").disabled = true; $("#loadMoreGames").disabled = true;
    $("#communityStatus").textContent = more ? "正在加载更多创作…" : "正在同步云端作品…";
    try {
      if (!more) {
        try { viewer = (await api("/session")).user; }
        catch (error) { if (error.status === 401) viewer = null; else throw error; }
      }
      const offset = more ? nextOffset : 0;
      const [data, owned] = await Promise.all([
        api(`/games?offset=${offset || 0}`),
        !more && viewer ? api("/games?mine=1") : Promise.resolve({ games: [] })
      ]);
      addGames([...(data.games || []), ...(owned.games || [])]);
      if (!more) {
        const accessible = new Set([...(data.games || []), ...(owned.games || [])].map((game) => game.id));
        for (const [id, game] of catalog) {
          if (!accessible.has(id)) {
            catalog.delete(id);
            document.querySelector(`.community-card[data-game="${id}"]`)?.remove();
          }
        }
        play.reconcile([...catalog.keys()]);
      }
      nextOffset = data.hasMore ? data.nextOffset : null;
      $("#loadMoreGames").hidden = nextOffset === null;
      $("#communityStatus").textContent = catalog.size ? `已接通 ${catalog.size} 款创作游戏${viewer ? " · 你的私密作品仅你可见" : ""}` : "创作区已就绪，成为第一个上传游戏的人。";
      const requested = new URLSearchParams(location.search).get("game");
      if (!more && requested && !window.__lumonOpenedCommunityLink) {
        if (!catalog.has(requested) && /^game_[a-f0-9-]{36}$/.test(requested)) {
          try { const linked = await api(`/games/${requested}`); addGames([linked.game]); }
          catch (error) { play.toast(error.message); }
        }
        if (catalog.has(requested)) { window.__lumonOpenedCommunityLink = true; play.open(requested); }
      }
    } catch (error) {
      $("#communityStatus").textContent = error.message || "创作区暂时无法连接，内置游戏仍可游玩。";
    } finally {
      loading = false; $("#refreshCommunity").disabled = false; $("#loadMoreGames").disabled = false;
    }
  }
  $("#refreshCommunity").addEventListener("click", () => void loadCatalog());
  $("#loadMoreGames").addEventListener("click", () => void loadCatalog(true));

  function status(text, error = false) {
    $("#uploadStatus").textContent = text;
    $("#uploadStatus").classList.toggle("error", error);
  }
  function updateSubmitLabel() {
    $("#publishGame").textContent = editing ? "保存作品更新 ↗" : $("#uploadVisibility").value === "public" ? "发布到游戏大厅 ↗" : "保存我的游戏 ↗";
  }
  $("#uploadVisibility").addEventListener("change", updateSubmitLabel);

  async function showEditor(game = null) {
    if (uploadBusy) return;
    const version = ++editorRevision;
    editing = game;
    chosenFile = null; chosenHtml = ""; fileRevision++;
    $("#uploadForm").reset();
    $("#uploadForm").hidden = true; $("#uploadAuth").hidden = true;
    $("#uploadTitle").textContent = game ? "让你的作品，再进化一点。" : "你的游戏，值得被玩到。";
    $("#fileName").textContent = game ? game.filename : "把游戏拖到这里";
    $("#fileHint").textContent = game ? "点击替换文件；不选择则保留已有游戏" : "或点击选择 .html / .htm 文件 · 最多 1 MiB";
    $("#deleteGameButton").hidden = !game; $("#deleteConfirm").hidden = true;
    $("#uploadProgress").hidden = true;
    $("#uploadChecking").hidden = false;
    $("#uploadAuth p").textContent = "登录 Lumon，上传和管理属于你的游戏。";
    status("");
    if (!uploadDialog.open) uploadDialog.showModal();
    try {
      viewer = (await api("/session")).user;
      if (version !== editorRevision || !uploadDialog.open) return;
      $("#uploadForm").hidden = false;
      $("#uploadChecking").hidden = true;
      if (game) {
        $("#uploadName").value = game.title;
        $("#uploadCategory").value = game.category;
        $("#uploadSummary").value = game.summary;
        $("#uploadInstructions").value = game.instructions;
        $("#uploadVisibility").value = game.visibility;
        $("#uploadForm").elements.color.value = game.color;
      }
      updateSubmitLabel();
      $("#uploadName").focus({ preventScroll: true });
    } catch (error) {
      if (version !== editorRevision || !uploadDialog.open) return;
      if (error.status === 401) { viewer = null; $("#uploadAuth").hidden = false; }
      else {
        $("#uploadAuth").hidden = false;
        $("#uploadAuth p").textContent = error.message || "登录服务暂时无法连接，请稍后重试。";
      }
      $("#uploadChecking").hidden = true;
    }
  }
  $("#uploadGameButton").addEventListener("click", () => void showEditor());
  $("#closeUpload").addEventListener("click", () => { if (!uploadBusy) uploadDialog.close(); });
  uploadDialog.addEventListener("cancel", (event) => { if (uploadBusy) event.preventDefault(); });
  uploadDialog.addEventListener("close", () => { editorRevision++; fileRevision++; });
  $("#fileDrop").addEventListener("click", () => { if (!uploadBusy) $("#gameFile").click(); });

  async function chooseFile(file) {
    const version = ++fileRevision;
    chosenFile = null; chosenHtml = "";
    if (!file) return;
    try {
      if (!/\.html?$/i.test(file.name)) throw new Error("请选择 .html 或 .htm 文件；多文件项目请先打包为单文件 HTML。");
      if (!file.size || file.size > MAX_BYTES) throw new Error("游戏文件需要大于 0 且不能超过 1 MiB。");
      let html;
      try { html = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()); }
      catch { throw new Error("文件需要使用 UTF-8 编码，请重新保存后上传。"); }
      if (version !== fileRevision || !uploadDialog.open) return;
      if (!/<(?:!doctype\s+html|html|head|body|canvas|script|div|main|svg)\b/i.test(html) || html.includes("\u0000")) throw new Error("没有识别到 HTML 页面内容，请检查文件。");
      chosenFile = file; chosenHtml = html;
      $("#fileName").textContent = file.name;
      $("#fileHint").textContent = `${(file.size / 1024).toFixed(1)} KiB · 已准备好，可以先本地试玩`;
      if (!$("#uploadName").value.trim()) $("#uploadName").value = file.name.replace(/\.html?$/i, "").slice(0, 60);
      status("文件已读取，点击「本地试玩」看看实际效果。");
    } catch (error) {
      if (version !== fileRevision) return;
      $("#gameFile").value = "";
      $("#fileName").textContent = editing ? editing.filename : "重新选择游戏文件";
      $("#fileHint").textContent = editing ? "已有游戏保持不变，可再次选择替换文件" : "支持 UTF-8 单文件 HTML，最多 1 MiB";
      status(error.message, true);
    }
  }
  $("#gameFile").addEventListener("change", () => void chooseFile($("#gameFile").files[0]));
  for (const type of ["dragenter", "dragover"]) $("#fileDrop").addEventListener(type, (event) => { event.preventDefault(); if (!uploadBusy) $("#fileDrop").classList.add("dragging"); });
  for (const type of ["dragleave", "drop"]) $("#fileDrop").addEventListener(type, (event) => { event.preventDefault(); $("#fileDrop").classList.remove("dragging"); });
  $("#fileDrop").addEventListener("drop", (event) => {
    if (uploadBusy) return;
    const files = event.dataTransfer.files;
    if (files.length !== 1) { status("一次请选择一个 HTML 游戏文件。", true); return; }
    void chooseFile(files[0]);
  });

  $("#previewUpload").addEventListener("click", async () => {
    const version = editorRevision;
    try {
      let html = chosenHtml;
      if (!html && editing) html = (await api(`/games/${editing.id}`)).game.html;
      if (version !== editorRevision || !uploadDialog.open) return;
      if (!html) { status("请先选择游戏文件，再进行本地试玩。", true); return; }
      $("#previewTitle").textContent = $("#uploadName").value.trim() || "试玩你的游戏";
      $("#previewStage").replaceChildren(frameFor(html, $("#previewTitle").textContent));
      if (!previewDialog.open) previewDialog.showModal();
    } catch (error) { status(error.message, true); }
  });
  $("#closePreview").addEventListener("click", () => previewDialog.close());
  previewDialog.addEventListener("close", () => $("#previewStage").replaceChildren());

  function setBusy(value) {
    uploadBusy = value;
    $("#uploadForm").querySelectorAll("button,input,textarea,select").forEach((element) => { element.disabled = value; });
    $("#closeUpload").disabled = value;
    uploadDialog.setAttribute("aria-busy", String(value));
  }

  function upload(form, id) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(id ? "PATCH" : "POST", `/api/games${id ? `/${id}` : ""}`);
      xhr.timeout = 45000;
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          const percent = Math.min(99, Math.round(event.loaded / event.total * 100));
          $("#uploadProgressBar").value = percent;
          $("#uploadProgressText").textContent = percent >= 99 ? "文件已传送，正在保存到云端…" : `正在上传 ${percent}%`;
        }
      });
      xhr.addEventListener("load", () => {
        let data;
        try { data = JSON.parse(xhr.responseText); }
        catch { reject(new Error("上传接口尚未部署。请把 functions/api/games 一并部署到 Cloudflare。")); return; }
        if (xhr.status < 200 || xhr.status >= 300 || data.success === false) {
          const error = new Error(data.message || `上传失败 (${xhr.status})`); error.status = xhr.status; reject(error); return;
        }
        resolve(data);
      });
      xhr.addEventListener("error", () => reject(new Error("网络中断。请先刷新作品列表，确认是否已保存，再重新上传。")));
      xhr.addEventListener("timeout", () => reject(new Error("保存超时。请先刷新作品列表，确认是否已保存，避免重复上传。")));
      xhr.send(form);
    });
  }

  $("#uploadForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (uploadBusy) return;
    if (!chosenFile && !editing) { status("请先选择游戏 HTML 文件。", true); return; }
    if (!$("#uploadForm").reportValidity()) return;
    const form = new FormData($("#uploadForm"));
    if (chosenFile) form.append("file", chosenFile, chosenFile.name);
    setBusy(true); status("正在保存作品…");
    $("#uploadProgress").hidden = false;
    $("#uploadProgressBar").value = 0;
    $("#uploadProgressText").textContent = "正在上传…";
    try {
      const data = await upload(form, editing?.id);
      addGames([data.game]);
      $("#uploadProgressBar").value = 100;
      setBusy(false); uploadDialog.close();
      play.setFilter("mine");
      play.toast(data.game.visibility === "public" ? "作品已公开，大家可以来玩了。" : "作品已保存，仅你自己可见。");
      $("#communityStatus").textContent = "作品已保存到云端，刷新后仍可继续游玩。";
      await loadCatalog();
    } catch (error) {
      setBusy(false); status(error.message, true);
      if (error.status === 401) status("登录已过期，请关闭窗口并重新登录后再上传。", true);
    }
  });

  $("#deleteGameButton").addEventListener("click", () => { $("#deleteConfirm").hidden = false; $("#confirmDelete").focus(); });
  $("#cancelDelete").addEventListener("click", () => { $("#deleteConfirm").hidden = true; });
  $("#confirmDelete").addEventListener("click", async () => {
    if (!editing || uploadBusy) return;
    setBusy(true);
    try {
      await api(`/games/${editing.id}`, { method: "DELETE" });
      const id = editing.id; catalog.delete(id);
      document.querySelector(`.community-card[data-game="${id}"]`)?.remove();
      play.remove(id); setBusy(false); uploadDialog.close(); play.toast("作品已从云端删除。");
      await loadCatalog();
    } catch (error) { setBusy(false); status(error.message, true); }
  });

  void loadCatalog();
  if (location.hash === "#upload") void showEditor();
})();
