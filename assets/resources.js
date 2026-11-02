(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const categories = { document: "文档", image: "图片", audio: "音频", video: "视频", archive: "压缩包", other: "其他" };
  let files = [];
  let quota = { files: 50, fileBytes: 20 * 1024 * 1024, totalBytes: 200 * 1024 * 1024, usedFiles: 0, usedBytes: 0 };
  let activeFilter = "all";
  let pendingDownload = null;
  let uploadActive = false;
  let toastTimer;

  requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add("page-ready")));

  function toast(text, error = false) {
    const element = $("#toast");
    element.textContent = text;
    element.style.borderColor = error ? "var(--accent)" : "var(--line)";
    element.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove("visible"), 3000);
  }

  async function api(path, options = {}) {
    const response = await fetch(`/api/resources${path}`, { credentials: "same-origin", cache: "no-store", ...options });
    const type = response.headers.get("Content-Type") || "";
    if (!type.includes("application/json")) throw new Error("资源空间接口暂未部署，请将 Pages Functions 与网页一起部署。");
    const data = await response.json();
    if (!response.ok || data.success === false) {
      const error = new Error(data.message || `请求失败 (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function readableSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 100 * 1024 ? 1 : 0)} KiB`;
    return `${(bytes / 1024 / 1024).toFixed(bytes < 100 * 1024 * 1024 ? 1 : 0)} MiB`;
  }

  function dateLabel(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "刚刚";
    return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  }

  function updateQuota() {
    const ratio = quota.totalBytes ? Math.min(100, quota.usedBytes / quota.totalBytes * 100) : 0;
    $("#quotaLabel").textContent = `${readableSize(quota.usedBytes)} / ${readableSize(quota.totalBytes)}`;
    $("#quotaBar").style.width = `${ratio}%`;
    $("#quotaBar").style.background = ratio >= 90 ? "#c64b42" : "var(--accent)";
    $("#quotaMeta").textContent = `已使用 ${quota.usedFiles} / ${quota.files} 个文件 · 单个最多 ${readableSize(quota.fileBytes)}`;
    $("#downloadUsage").textContent = `${quota.todayDownloads || 0} / ${quota.dailyDownloadLimit || 500} 次`;
    $("#downloadUsageMeta").textContent = `${readableSize(quota.todayDownloadBytes || 0)} / ${readableSize(quota.dailyDownloadBytesLimit || 2 * 1024 * 1024 * 1024)} 今日下载流量`;
  }

  function makeFileRow(file, index) {
    const row = document.createElement("article");
    row.className = "file-row";
    row.style.animationDelay = `${Math.min(index * 28, 280)}ms`;
    row.dataset.category = file.category;
    row.dataset.name = file.filename.toLowerCase();
    const identity = document.createElement("div"); identity.className = "file-ident";
    const icon = document.createElement("span"); icon.className = `file-icon ${file.category}`;
    const use = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const ref = document.createElementNS("http://www.w3.org/2000/svg", "use"); ref.setAttribute("href", "#r-file"); use.append(ref); icon.append(use);
    const copy = document.createElement("span"); copy.className = "file-copy";
    const name = document.createElement("strong"); name.textContent = file.filename; name.title = file.filename;
    const detail = document.createElement("small"); detail.textContent = `.${file.extension.toUpperCase()} · 仅自己可见`;
    copy.append(name, detail); identity.append(icon, copy);
    const category = document.createElement("span"); category.className = "file-category"; category.textContent = categories[file.category] || categories.other;
    const date = document.createElement("span"); date.className = "file-date"; date.textContent = dateLabel(file.created_at);
    const size = document.createElement("span"); size.className = "file-size"; size.textContent = readableSize(Number(file.byte_size));
    const actions = document.createElement("div"); actions.className = "file-actions";
    const download = document.createElement("button"); download.type = "button"; download.setAttribute("aria-label", `下载 ${file.filename}`); download.title = "下载";
    download.innerHTML = '<svg><use href="#r-download"></use></svg>';
    download.addEventListener("click", () => askDownload(file));
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "delete-file"; remove.setAttribute("aria-label", `删除 ${file.filename}`); remove.title = "删除";
    remove.innerHTML = '<svg><use href="#r-trash"></use></svg>';
    remove.addEventListener("click", () => void deleteFile(file));
    actions.append(download, remove);
    row.append(identity, category, date, size, actions);
    return row;
  }

  function renderFiles() {
    const list = $("#fileList"); list.replaceChildren();
    const search = $("#fileSearch").value.trim().toLocaleLowerCase();
    const visible = files.filter((file) => (activeFilter === "all" || file.category === activeFilter) && (!search || file.filename.toLocaleLowerCase().includes(search)));
    visible.forEach((file, index) => list.append(makeFileRow(file, index)));
    $("#fileCount").textContent = String(files.length);
    $("#emptyState").hidden = visible.length > 0;
    $("#emptyTitle").textContent = files.length && !visible.length ? "没有匹配的文件" : "这里还没有文件";
    $("#emptyCopy").textContent = files.length && !visible.length ? "换个关键词或类别，再找找看。" : "上传第一份资源，让它在需要时随时可用。";
    document.querySelectorAll("[data-filter]").forEach((button) => {
      const active = button.dataset.filter === activeFilter;
      button.classList.toggle("active", active); button.setAttribute("aria-pressed", String(active));
    });
  }

  async function loadFiles() {
    $("#statusText").textContent = "正在同步文件列表…";
    $("#refreshFiles").disabled = true;
    try {
      const data = await api("");
      files = Array.isArray(data.files) ? data.files : [];
      quota = data.quota || quota;
      updateQuota(); renderFiles();
      $("#statusText").textContent = `${files.length} 个私有文件 · 已与 Lumon Cloud 同步`;
    } catch (error) {
      if (error.status === 401) showAuth();
      $("#statusText").textContent = error.message || "暂时无法连接个人空间";
      if (error.status !== 401) toast(error.message || "读取失败", true);
    } finally { $("#refreshFiles").disabled = false; }
  }

  function showAuth(message = "个人资源空间仅对登录账户开放。") {
    $("#authMessage").textContent = message;
    $("#authCover").hidden = false;
    $("#loginLink").href = `loginaccount.html?next=${encodeURIComponent("resources.html")}`;
  }

  function upload(file) {
    if (uploadActive) return;
    if (!$("#uploadConsent").checked) {
      toast("请先阅读并同意上传安全条例。", true);
      return;
    }
    const form = new FormData();
    form.append("file", file, file.name);
    form.append("rulesAccepted", "on");
    const xhr = new XMLHttpRequest();
    uploadActive = true;
    xhr.open("POST", "/api/resources");
    xhr.withCredentials = true;
    xhr.timeout = 60000;
    $("#uploadProgress").hidden = false;
    $("#progressName").textContent = file.name;
    $("#progressPercent").textContent = "0%";
    $("#progressBar").value = 0;
    $("#chooseFile").disabled = true;
    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      const value = Math.min(99, Math.round(event.loaded / event.total * 100));
      $("#progressBar").value = value; $("#progressPercent").textContent = `${value}%`;
    });
    xhr.addEventListener("load", () => {
      let data;
      try { data = JSON.parse(xhr.responseText); }
      catch { toast("上传接口暂未部署。", true); finish(); return; }
      if (xhr.status < 200 || xhr.status >= 300 || !data.success) {
        toast(data.message || `上传失败 (${xhr.status})`, true);
        if (xhr.status === 401) showAuth();
        finish(); return;
      }
      $("#progressBar").value = 100; $("#progressPercent").textContent = "完成";
      $("#uploadProgress").classList.add("upload-complete");
      toast("文件已安全保存到你的个人空间。");
      setTimeout(() => { finish(); void loadFiles(); }, 550);
    });
    xhr.addEventListener("error", () => { toast("网络中断，文件尚未确认保存。", true); finish(); });
    xhr.addEventListener("timeout", () => { toast("上传超时，请刷新列表确认文件状态。", true); finish(); });
    xhr.send(form);
    function finish() { uploadActive = false; $("#chooseFile").disabled = false; setTimeout(() => { $("#uploadProgress").hidden = true; $("#uploadProgress").classList.remove("upload-complete"); }, 650); }
  }

  async function deleteFile(file) {
    if (!window.confirm(`确定从个人资源空间删除「${file.filename}」？此操作无法撤销。`)) return;
    try { await api(`/${encodeURIComponent(file.id)}`, { method: "DELETE" }); toast("文件已删除。"); await loadFiles(); }
    catch (error) { toast(error.message || "删除失败", true); if (error.status === 401) showAuth(); }
  }

  function askDownload(file) {
    pendingDownload = file;
    $("#downloadFilename").textContent = file.filename;
    $("#downloadConsent").checked = false;
    $("#confirmDownload").disabled = true;
    $("#downloadDialog").showModal();
  }

  $("#chooseFile").addEventListener("click", () => $("#fileInput").click());
  $("#fileInput").addEventListener("change", () => {
    const file = $("#fileInput").files[0];
    if (file) upload(file);
    $("#fileInput").value = "";
  });
  for (const eventName of ["dragenter", "dragover"]) $("#dropZone").addEventListener(eventName, (event) => { event.preventDefault(); $("#dropZone").classList.add("dragging"); });
  for (const eventName of ["dragleave", "drop"]) $("#dropZone").addEventListener(eventName, (event) => { event.preventDefault(); $("#dropZone").classList.remove("dragging"); });
  $("#dropZone").addEventListener("drop", (event) => {
    const dropped = [...(event.dataTransfer?.files || [])];
    if (dropped.length !== 1) { toast("一次请选择一个文件。", true); return; }
    upload(dropped[0]);
  });
  $("#fileSearch").addEventListener("input", renderFiles);
  document.querySelectorAll("[data-filter]").forEach((button) => button.addEventListener("click", () => { activeFilter = button.dataset.filter; renderFiles(); }));
  $("#refreshFiles").addEventListener("click", () => void loadFiles());
  $("#showUploadRules").addEventListener("click", () => $("#rulesDialog").showModal());
  $("#openRules").addEventListener("click", () => $("#rulesDialog").showModal());
  $("#readRules").addEventListener("click", () => $("#rulesDialog").showModal());
  $("#closeRules").addEventListener("click", () => $("#rulesDialog").close());
  $("#acceptRules").addEventListener("click", () => { $("#uploadConsent").checked = true; $("#rulesDialog").close(); toast("上传安全条例已确认。"); });
  $("#closeDownload").addEventListener("click", () => $("#downloadDialog").close());
  $("#cancelDownload").addEventListener("click", () => $("#downloadDialog").close());
  $("#downloadConsent").addEventListener("change", () => { $("#confirmDownload").disabled = !$("#downloadConsent").checked; });
  $("#confirmDownload").addEventListener("click", () => {
    if (!pendingDownload || !$("#downloadConsent").checked) return;
    const id = pendingDownload.id;
    $("#downloadDialog").close();
    window.location.assign(`/api/resources/${encodeURIComponent(id)}`);
    pendingDownload = null;
  });
  $("#themeToggle").addEventListener("click", () => window.PellosyTheme?.cycle());
  function syncTheme() { $("#themeName").textContent = window.PellosyTheme?.names[window.PellosyTheme.get()] || "流体玻璃"; }
  window.addEventListener("pellosy:theme-change", syncTheme);
  syncTheme();
  fetch("/api/session", { credentials: "same-origin", cache: "no-store" }).then(async (response) => {
    const data = await response.json();
    if (!response.ok || !data.success) { const error = new Error(data.message || "请登录后继续。"); error.status = response.status; throw error; }
    void loadFiles();
  }).catch((error) => {
    if (error.status === 401) showAuth();
    else { $("#statusText").textContent = error.message || "资源空间连接失败"; toast($("#statusText").textContent, true); }
  });
})();
