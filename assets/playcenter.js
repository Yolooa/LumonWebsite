(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const STORAGE_KEY = "lumon.playcenter.v1";
  const games = {
    "2048": { title: "2048", icon: "2", category: "puzzle", scoreLabel: "本局得分", bestLabel: "最高得分", help: "方向键 / WASD 或滑动合并数字；U 撤销一步。进度自动保存，下次可续玩。", unit: " 分" },
    snake: { title: "贪吃蛇", icon: "↝", category: "arcade", scoreLabel: "本局得分", bestLabel: "最高得分", help: "方向键 / WASD 或滑动转向；空格暂停。吃到食物加分，碰到边界或自己结束。", unit: " 分" },
    memory: { title: "记忆翻牌", icon: "✳", category: "puzzle", scoreLabel: "翻牌次数", bestLabel: "最少次数", help: "点击两张卡片寻找相同图案。16 张卡片，8 对图案，越少次数越出色。", unit: " 次" },
    reaction: { title: "反应挑战", icon: "↯", category: "reaction", scoreLabel: "反应时间", bestLabel: "最快反应", help: "点击开始，等待绿色出现后立刻点击，或按空格。共 5 轮，提前点击需要重试。", unit: " ms" }
  };
  Object.setPrototypeOf(games, null);
  const knownGameId = (id) => typeof id === "string" && (Boolean(games[id]) || /^game_[a-f0-9-]{36}$/.test(id));

  function readState() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      if (!data || typeof data !== "object") return {};
      return data;
    } catch { return {}; }
  }
  const stored = readState();
  const state = {
    favorites: Array.isArray(stored.favorites) ? stored.favorites.filter(knownGameId) : [],
    recent: Array.isArray(stored.recent) ? stored.recent.filter((item) => item && knownGameId(item.id) && Number.isFinite(item.at)).slice(0, 3) : [],
    best: {},
    save2048: null
  };
  for (const id of Object.keys(games)) {
    const best = stored.best?.[id];
    if (Number.isFinite(best) && best > 0) state.best[id] = best;
  }
  const saved = stored.save2048;
  if (saved && Array.isArray(saved.board) && saved.board.length === 16
    && saved.board.every((n) => Number.isInteger(n) && n >= 0 && n <= 131072 && (n === 0 || (n >= 2 && (n & (n - 1)) === 0)))
    && Number.isSafeInteger(saved.score) && saved.score >= 0 && saved.board.some((n) => n > 0)) {
    state.save2048 = { board: [...saved.board], score: saved.score };
  }
  let storageNotice = false;
  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch {
      if (!storageNotice) { storageNotice = true; toast("浏览器存储不可用，本次成绩暂存于当前页面。"); }
    }
  }

  let toastTimer;
  function toast(text) {
    clearTimeout(toastTimer);
    $("#toastText").textContent = text;
    $("#toast").classList.add("visible");
    toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 2600);
  }
  let soundEnabled = false;
  let audio;
  function tone(frequency = 500, length = .07) {
    if (!soundEnabled || !audio) return;
    if (audio.state === "suspended") { void audio.resume().catch(() => {}); return; }
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, audio.currentTime);
    gain.gain.setValueAtTime(.035, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(.0001, audio.currentTime + length);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + length);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
  $("#soundToggle").addEventListener("click", async () => {
    try {
      if (!audio) {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) { toast("当前浏览器不支持游戏音效。"); return; }
        audio = new Audio();
      }
      await audio.resume();
      soundEnabled = !soundEnabled;
      $("#soundToggle").setAttribute("aria-pressed", String(soundEnabled));
      $("#soundToggle").setAttribute("aria-label", soundEnabled ? "关闭游戏音效" : "开启游戏音效");
      tone(620);
      toast(soundEnabled ? "游戏音效已开启" : "游戏音效已关闭");
    } catch { toast("浏览器暂时无法开启音效。"); }
  });

  function updateTheme() {
    const api = window.PellosyTheme;
    $("#themeLabel").textContent = api?.names[api.get()] || "流体玻璃";
    if (currentGame?.redraw) currentGame.redraw();
  }
  $("#themeToggle").addEventListener("click", () => { window.PellosyTheme?.cycle(); updateTheme(); });
  window.addEventListener("pellosy:theme-change", updateTheme);
  function clock() {
    const now = new Date();
    $("#localClock").textContent = now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
    $("#dateLabel").textContent = now.toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" });
  }
  function ago(at) {
    const minutes = Math.max(0, Math.floor((Date.now() - at) / 60000));
    if (minutes < 1) return "刚刚玩过";
    if (minutes < 60) return `${minutes} 分钟前`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`;
    return `${Math.floor(minutes / 1440)} 天前`;
  }
  function renderRecords() {
    const recent = $("#recentGames");
    recent.replaceChildren();
    const availableRecent = state.recent.filter((item) => games[item.id]);
    if (!availableRecent.length) {
      const empty = document.createElement("p");
      empty.className = "side-empty";
      empty.append("第一局，从喜欢的开始。", document.createElement("br"), "你的游玩记录会留在这里。");
      recent.append(empty);
    }
    for (const item of availableRecent) {
      const game = games[item.id];
      const button = document.createElement("button");
      button.className = "recent-game";
      button.setAttribute("aria-label", `继续玩${game.title}`);
      const icon = document.createElement("span"); icon.className = "recent-icon"; icon.textContent = game.icon;
      const name = document.createElement("span"); name.textContent = game.title;
      const time = document.createElement("small"); time.textContent = ago(item.at); name.append(time);
      const arrow = document.createElement("span"); arrow.textContent = "↗";
      button.append(icon, name, arrow);
      button.addEventListener("click", () => openGame(item.id));
      recent.append(button);
    }
    const records = $("#bestScores"); records.replaceChildren();
    for (const [id, game] of Object.entries(games)) {
      if (game.community) continue;
      const row = document.createElement("div"); row.className = "record-line";
      const title = document.createElement("span"); title.textContent = game.title;
      const score = document.createElement("strong"); score.textContent = state.best[id] ? `${state.best[id].toLocaleString()}${game.unit}` : "—";
      row.append(title, score); records.append(row);
    }
  }
  function markPlayed(id) {
    state.recent = [{ id, at: Date.now() }, ...state.recent.filter((item) => item.id !== id)].slice(0, 3);
    persist(); renderRecords();
  }
  let filter = "all";
  function filterGames() {
    const query = $("#gameSearch").value.trim().toLowerCase();
    let count = 0;
    $$(".game-card").forEach((card) => {
      const match = (filter === "all" || (filter === "favorites" ? state.favorites.includes(card.dataset.game)
        : filter === "mine" ? card.dataset.owned === "true"
        : filter === "community" ? card.dataset.community === "true"
        : card.dataset.category === filter))
        && (!query || card.dataset.search.toLowerCase().includes(query));
      card.hidden = !match;
      if (match) count++;
    });
    $("#emptyState").hidden = count > 0;
    $("#emptyMessage").textContent = filter === "favorites" && !query ? "点亮游戏卡片右上角的星星，把喜欢的留在这里。"
      : filter === "mine" && !query ? "上传你的第一个作品，让灵感变成可以玩的游戏。"
      : filter === "community" && !query ? "这里等待你的创作。上传一个游戏，让更多人来玩。" : "换个关键词，再找找看。";
    if ($("#gameCount")) $("#gameCount").textContent = String($$(".game-card").length).padStart(2, "0");
    $("#gameGrid").classList.toggle("is-filtered", filter !== "all" || !!query);
    $$("[data-filter]").forEach((button) => {
      const active = button.dataset.filter === filter;
      button.classList.toggle("active", active); button.setAttribute("aria-pressed", String(active));
    });
  }
  function renderFavorites() {
    $$("[data-favorite]").forEach((button) => {
      const id = button.dataset.favorite;
      const active = state.favorites.includes(id);
      button.setAttribute("aria-pressed", String(active));
      button.setAttribute("aria-label", `${active ? "取消收藏" : "收藏"} ${games[id].title}`);
    });
  }
  $$("[data-filter]").forEach((button) => button.addEventListener("click", () => { filter = button.dataset.filter; filterGames(); }));
  $("#gameSearch").addEventListener("input", filterGames);
  $("#resetFilters").addEventListener("click", () => { filter = "all"; $("#gameSearch").value = ""; filterGames(); });
  $("#gameGrid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-favorite]");
    if (!button) return;
    const id = button.dataset.favorite;
    if (!games[id]) return;
    const active = state.favorites.includes(id);
    state.favorites = active ? state.favorites.filter((value) => value !== id) : [...state.favorites, id];
    persist(); renderFavorites(); filterGames();
    toast(active ? `已取消收藏 ${games[id].title}` : `已收藏 ${games[id].title}`); tone(680);
  });

  const dialog = $("#gameDialog");
  let currentId = null;
  let currentGame = null;
  let lastLauncher = null;
  function message(text, win = false) {
    const target = $("#gameMessage");
    target.textContent = text;
    target.classList.toggle("win", win);
    target.classList.toggle("burst", win);
  }
  function score(value) { $("#gameScore").textContent = typeof value === "number" ? value.toLocaleString() : value; }
  function best(value) {
    if (!currentId || !Number.isFinite(value) || value <= 0) return;
    const previous = state.best[currentId];
    const lowerIsBetter = currentId === "memory" || currentId === "reaction";
    if (!previous || (lowerIsBetter ? value < previous : value > previous)) {
      state.best[currentId] = value; persist(); renderRecords();
    }
    $("#gameBest").textContent = state.best[currentId]?.toLocaleString() || "—";
  }
  const factories = { "2048": create2048, snake: createSnake, memory: createMemory, reaction: createReaction };
  function openGame(id) {
    if (!games[id]) return;
    lastLauncher = document.activeElement;
    currentGame?.destroy();
    currentId = id;
    const game = games[id];
    dialog.classList.toggle("custom-game", Boolean(game.community));
    $("#restartGame").textContent = game.community ? "↻ 重新载入" : "↻ 重新开始";
    $("#gameTitle").textContent = game.title;
    $("#scoreLabel").textContent = game.scoreLabel;
    $("#bestLabel").textContent = game.bestLabel;
    $("#gameBest").textContent = state.best[id]?.toLocaleString() || "—";
    $("#gameHelp").textContent = game.help;
    $("#gameStage").replaceChildren(); score(0); message("");
    document.body.classList.add("game-open");
    if (!dialog.open) dialog.showModal();
    dialog.append($("#toast"));
    currentGame = game.community ? window.LumonCommunity.createPlayer(game) : factories[id]();
    markPlayed(id);
    currentGame.focus?.();
    tone(420);
  }
  function cleanupGame() {
    currentGame?.destroy(); currentGame = null; currentId = null;
    document.body.classList.remove("game-open");
    document.body.append($("#toast"));
    renderRecords();
    if (document.fullscreenElement === dialog) void document.exitFullscreen().catch(() => {});
    if (lastLauncher?.isConnected) lastLauncher.focus({ preventScroll: true });
  }
  $("#gameGrid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-launch]");
    if (button) openGame(button.dataset.launch);
  });
  function randomGame() {
    const candidates = $$(".game-card").filter((card) => !card.hidden).map((card) => card.dataset.game);
    const choices = candidates.length ? candidates : Object.keys(games);
    openGame(choices[Math.floor(Math.random() * choices.length)]);
  }
  $("#randomGame").addEventListener("click", randomGame);
  $("#surpriseButton").addEventListener("click", randomGame);
  $("#closeGame").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", cleanupGame);
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  });
  $("#restartGame").addEventListener("click", () => { currentGame?.restart(); currentGame?.focus?.(); });
  $("#fullscreenButton").addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (dialog.requestFullscreen) await dialog.requestFullscreen();
      else toast("当前浏览器不支持全屏，请使用横屏游玩。");
    } catch { toast("当前浏览器暂时无法进入全屏。"); }
  });
  document.addEventListener("keydown", (event) => {
    if (!dialog.open || !currentGame || event.ctrlKey || event.metaKey || event.altKey || event.key === "Escape") return;
    const element = event.target;
    if (element instanceof HTMLElement && (element.closest(".window-actions, .restart-button") || /INPUT|TEXTAREA|SELECT/.test(element.tagName))) return;
    currentGame.key?.(event);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) currentGame?.pause?.();
    else { clock(); renderRecords(); }
  });
  window.addEventListener("blur", () => currentGame?.pause?.());
  window.addEventListener("pagehide", () => { currentGame?.destroy(); currentGame = null; });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted && dialog.open && !currentGame) dialog.close();
  });

  function directions(key) {
    return { ArrowLeft: "left", a: "left", A: "left", ArrowRight: "right", d: "right", D: "right", ArrowUp: "up", w: "up", W: "up", ArrowDown: "down", s: "down", S: "down" }[key];
  }
  function controls(parent, action) {
    const bar = document.createElement("div"); bar.className = "board-controls";
    for (const [direction, label] of [["left", "←"], ["up", "↑"], ["down", "↓"], ["right", "→"]]) {
      const button = document.createElement("button"); button.textContent = label;
      button.setAttribute("aria-label", `向${({left:"左",up:"上",down:"下",right:"右"})[direction]}`);
      button.addEventListener("click", () => action(direction)); bar.append(button);
    }
    parent.append(bar); return bar;
  }
  function swipe(element, action, signal) {
    let start = null;
    element.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      start = { x: event.clientX, y: event.clientY, id: event.pointerId };
      element.setPointerCapture(event.pointerId);
    }, { signal });
    element.addEventListener("pointerup", (event) => {
      if (!start || start.id !== event.pointerId) return;
      const dx = event.clientX - start.x; const dy = event.clientY - start.y; start = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;
      action(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"));
    }, { signal });
    element.addEventListener("pointercancel", () => { start = null; }, { signal });
  }

  function create2048() {
    const abort = new AbortController();
    const boardElement = document.createElement("div");
    boardElement.className = "board-2048";
    boardElement.tabIndex = 0;
    boardElement.setAttribute("role", "group");
    boardElement.setAttribute("aria-label", "2048 棋盘，使用方向键或滑动移动");
    $("#gameStage").append(boardElement);

    const cells = Array.from({ length: 16 }, () => {
      const cell = document.createElement("div");
      cell.className = "cell-2048";
      boardElement.append(cell);
      return cell;
    });
    const tileLayer = document.createElement("div");
    tileLayer.className = "tile-layer-2048";
    tileLayer.setAttribute("aria-hidden", "true");
    const effectLayer = document.createElement("div");
    effectLayer.className = "effect-layer-2048";
    effectLayer.setAttribute("aria-hidden", "true");
    boardElement.append(tileLayer, effectLayer);

    const scorePanel = $("#gameScore").parentElement;
    scorePanel.classList.add("score-panel-2048");
    controls($("#gameStage"), move);
    const undoButton = document.createElement("button");
    undoButton.className = "text-button undo-2048";
    undoButton.textContent = "↶ 撤销一步 · U";
    $("#gameStage").append(undoButton);

    let board = []; let points = 0; let undo = null;
    let ended = false; let won = false; let mergeStreak = 0;
    let tiles = new Map(); let moving = false; let pendingDirection = null;
    let slideTimer; let revision = 0; let alive = true;
    const animations = new Set();
    const effects = new Set();
    const colors = ["#ede4d3", "#e8d2af", "#efb17d", "#f39a70", "#ed7957", "#df6048", "#ddbb53", "#dca944", "#d19632", "#bc8425", "#aa7020"];

    function motionEnabled() {
      return !reducedMotion.matches && typeof boardElement.animate === "function";
    }

    // Track every animation, including score effects outside the board, so
    // restarting, undoing or leaving the game cannot leave a delayed effect.
    function animate(element, frames, options, temporary = false) {
      if (!motionEnabled() || !alive) {
        if (temporary) element.remove();
        return;
      }
      if (temporary) {
        if (effects.size >= 80) {
          const oldest = effects.values().next().value;
          oldest.getAnimations().forEach((animation) => animation.cancel());
          oldest.remove();
          effects.delete(oldest);
        }
        effects.add(element);
      }
      const animation = element.animate(frames, options);
      animations.add(animation);
      const cleanup = () => {
        animations.delete(animation);
        if (temporary) { element.remove(); effects.delete(element); }
      };
      animation.onfinish = cleanup;
      animation.oncancel = cleanup;
      return animation;
    }

    function cancelMotion() {
      revision++;
      clearTimeout(slideTimer);
      moving = false;
      pendingDirection = null;
      for (const animation of [...animations]) animation.cancel();
      animations.clear();
      for (const element of effects) element.remove();
      effects.clear();
      effectLayer.replaceChildren();
    }

    function save() {
      state.save2048 = ended ? null : { board: [...board], score: points };
      persist();
    }

    function spawn() {
      const empty = board.flatMap((value, index) => value === 0 ? [index] : []);
      if (!empty.length) return -1;
      const index = empty[Math.floor(Math.random() * empty.length)];
      board[index] = Math.random() < .9 ? 2 : 4;
      return index;
    }

    function canMove() {
      return board.some((value, index) => value === 0
        || (index % 4 < 3 && value === board[index + 1])
        || (index < 12 && value === board[index + 4]));
    }

    function skin(element, value) {
      const level = Math.log2(value);
      element.style.setProperty("--tile-bg", colors[Math.min(level - 1, colors.length - 1)]);
      element.style.setProperty("--tile-ink", level >= 4 ? "#fffaf0" : "#493429");
      element.style.setProperty("--tile-glow", level >= 7 ? "#f2b836" : colors[Math.min(level - 1, colors.length - 1)]);
    }

    function place(tile, index) {
      tile.style.setProperty("--tile-col", index % 4);
      tile.style.setProperty("--tile-row", Math.floor(index / 4));
    }

    function setValue(tile, value) {
      skin(tile, value);
      tile.dataset.value = value;
      tile.querySelector(".tile-digit-2048").textContent = value;
      tile.classList.toggle("large-number", value >= 1024);
      tile.classList.toggle("huge-number", value >= 16384);
    }

    function makeTile(value, index) {
      const tile = document.createElement("div");
      tile.className = "tile-2048";
      const face = document.createElement("div");
      face.className = "tile-face-2048";
      const digit = document.createElement("span");
      digit.className = "tile-digit-2048";
      face.append(digit); tile.append(face);
      place(tile, index); setValue(tile, value);
      tileLayer.append(tile);
      return tile;
    }

    function updateStats() {
      cells.forEach((cell, index) => {
        cell.setAttribute("aria-label", `第 ${Math.floor(index / 4) + 1} 行，第 ${index % 4 + 1} 列：${board[index] || "空"}`);
      });
      score(points); best(points);
      undoButton.disabled = !undo;
    }

    function appear(tile, delay = 0) {
      animate(tile.querySelector(".tile-face-2048"), [
        { transform: "scale(.25) rotate(-9deg)", opacity: 0 },
        { transform: "scale(1.1) rotate(2deg)", opacity: 1, offset: .65 },
        { transform: "scale(.97) rotate(-1deg)", opacity: 1, offset: .83 },
        { transform: "scale(1) rotate(0)", opacity: 1 }
      ], { duration: 330, delay, easing: "cubic-bezier(.2,.8,.25,1)", fill: "backwards" });
    }

    function renderBoard(entrance = false) {
      tileLayer.replaceChildren();
      tiles = new Map();
      for (let index = 0; index < board.length; index++) {
        if (!board[index]) continue;
        const tile = makeTile(board[index], index);
        tiles.set(index, tile);
        if (entrance) appear(tile, tiles.size * 45);
      }
      updateStats();
    }

    function layout() {
      return cells.map((cell) => ({ x: cell.offsetLeft, y: cell.offsetTop, width: cell.offsetWidth, height: cell.offsetHeight }));
    }

    function effect(className, x, y, value) {
      const element = document.createElement("span");
      element.className = className;
      element.style.left = `${x}px`;
      element.style.top = `${y}px`;
      if (value) skin(element, value);
      effectLayer.append(element);
      return element;
    }

    function trail(value, from, to) {
      const trace = effect("tile-trail-2048", from.x, from.y, value);
      trace.style.width = `${from.width}px`;
      trace.style.height = `${from.height}px`;
      animate(trace, [
        { transform: "translate(0,0) scale(.96)", opacity: .24 },
        { transform: `translate(${(to.x - from.x) * .45}px,${(to.y - from.y) * .45}px) scale(.8)`, opacity: 0 }
      ], { duration: 180, easing: "ease-out" }, true);
    }

    function collision(tile, value, direction) {
      const face = tile.querySelector(".tile-face-2048");
      const horizontal = direction === "left" || direction === "right";
      const tilt = direction === "left" || direction === "up" ? -2 : 2;
      animate(face, [
        { transform: horizontal ? "scale(1.16,.84)" : "scale(.84,1.16)", offset: 0 },
        { transform: `scale(.92,1.11) rotate(${tilt}deg)`, offset: .27 },
        { transform: "scale(1.075,.96) rotate(0)", offset: .53 },
        { transform: "scale(.985,1.025)", offset: .75 },
        { transform: "scale(1,1)", offset: 1 }
      ], { duration: value >= 128 ? 410 : 340, easing: "cubic-bezier(.22,.7,.25,1)" });
      animate(face, [
        { boxShadow: "0 0 0 0 var(--tile-glow), inset 0 0 22px #ffffffc0" },
        { boxShadow: `0 0 ${value >= 128 ? 29 : 18}px 2px var(--tile-glow), inset 0 0 0 #ffffff00`, offset: .28 },
        { boxShadow: "0 0 0 0 transparent, inset 0 0 0 transparent" }
      ], { duration: 490, easing: "ease-out" });
      animate(tile.querySelector(".tile-digit-2048"), [
        { transform: "scale(.5)", opacity: .2 },
        { transform: "scale(1.2)", opacity: 1, offset: .5 },
        { transform: "scale(1)", opacity: 1 }
      ], { duration: 290, easing: "cubic-bezier(.2,.8,.25,1)" });
    }

    function burst(value, box, budget) {
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      const ring = effect("merge-ring-2048", x, y, value);
      ring.style.width = `${box.width * .75}px`;
      ring.style.height = `${box.height * .75}px`;
      animate(ring, [
        { transform: "translate(-50%,-50%) scale(.45)", opacity: .85 },
        { transform: "translate(-50%,-50%) scale(1.75)", opacity: 0 }
      ], { duration: value >= 128 ? 580 : 440, easing: "cubic-bezier(.1,.7,.2,1)" }, true);

      const label = effect("merge-points-2048", x, box.y + 12, value);
      label.textContent = `+${value}`;
      animate(label, [
        { transform: "translate(-50%,9px) scale(.6)", opacity: 0 },
        { transform: "translate(-50%,-9px) scale(1.12)", opacity: 1, offset: .23 },
        { transform: "translate(-50%,-27px) scale(1)", opacity: 1, offset: .66 },
        { transform: "translate(-50%,-48px) scale(.94)", opacity: 0 }
      ], { duration: 750, easing: "ease-out" }, true);

      const count = Math.min(budget, value >= 128 ? 10 : 6);
      for (let index = 0; index < count; index++) {
        const angle = Math.PI * 2 * index / count + Math.random() * .28;
        const distance = box.width * (.38 + Math.random() * .4);
        const dx = Math.cos(angle) * distance;
        const dy = Math.sin(angle) * distance;
        const spark = effect(`merge-spark-2048${index % 3 === 0 ? " spark-star" : ""}`, x, y, value);
        if (index % 3 === 0) spark.textContent = "✦";
        spark.style.setProperty("--spark-size", `${3 + Math.random() * 4}px`);
        const rotation = Math.round(Math.random() * 180 - 90);
        animate(spark, [
          { transform: "translate(-50%,-50%) scale(.25) rotate(0)", opacity: 0 },
          { transform: `translate(calc(-50% + ${dx * .25}px),calc(-50% + ${dy * .25}px)) scale(1) rotate(${rotation * .3}deg)`, opacity: .95, offset: .18 },
          { transform: `translate(calc(-50% + ${dx}px),calc(-50% + ${dy + 18}px)) scale(.15) rotate(${rotation}deg)`, opacity: 0 }
        ], { duration: 450 + Math.random() * 260, easing: "cubic-bezier(.15,.6,.3,1)" }, true);
      }
    }

    function scoreFeedback(gain) {
      const bonus = document.createElement("span");
      bonus.className = "score-bonus-2048";
      bonus.setAttribute("aria-hidden", "true");
      bonus.textContent = `+${gain.toLocaleString()}`;
      scorePanel.append(bonus);
      animate(bonus, [
        { transform: "translateY(8px) scale(.65)", opacity: 0 },
        { transform: "translateY(-7px) scale(1.1)", opacity: 1, offset: .23 },
        { transform: "translateY(-18px) scale(1)", opacity: 1, offset: .65 },
        { transform: "translateY(-37px) scale(.95)", opacity: 0 }
      ], { duration: 790, easing: "ease-out" }, true);
      animate($("#gameScore"), [
        { transform: "scale(1)", color: "var(--ink)" },
        { transform: "scale(1.18)", color: "var(--accent)", offset: .25 },
        { transform: "scale(1)", color: "var(--ink)" }
      ], { duration: 360, easing: "cubic-bezier(.2,.8,.25,1)" });
    }

    function announceMerge(merges, largestBefore, direction) {
      const largest = Math.max(...merges.map((merge) => merge.value));
      const milestone = largest >= 128 && largest > largestBefore;
      let text = "";
      if (milestone) text = `${largest.toLocaleString()} · 新高度`;
      else if (merges.length >= 4) text = `${merges.length} 重合成 · 漂亮！`;
      else if (merges.length === 3) text = "三重合成 · NICE MOVE";
      else if (merges.length === 2) text = "双重合成 · DOUBLE MERGE";
      else if (mergeStreak >= 3) text = `连续 ${mergeStreak} 步合成 · KEEP GOING`;
      if (text) {
        const banner = effect("merge-banner-2048", boardElement.clientWidth / 2, 14, largest);
        banner.textContent = text;
        animate(banner, [
          { transform: "translate(-50%,8px) scale(.85)", opacity: 0 },
          { transform: "translate(-50%,-5px) scale(1.03)", opacity: 1, offset: .2 },
          { transform: "translate(-50%,-5px) scale(1)", opacity: 1, offset: .75 },
          { transform: "translate(-50%,-20px) scale(.98)", opacity: 0 }
        ], { duration: milestone ? 1250 : 900, easing: "ease-out" }, true);
      }
      if (milestone || merges.length >= 3) {
        const distance = largest >= 2048 ? 3 : 1.7;
        const horizontal = direction === "left" || direction === "right";
        const vector = horizontal ? `${distance}px,0` : `0,${distance}px`;
        animate(boardElement, [
          { transform: "translate(0,0)" },
          { transform: `translate(${vector})`, offset: .2 },
          { transform: horizontal ? `translate(${-distance}px,0)` : `translate(0,${-distance}px)`, offset: .43 },
          { transform: "translate(0,0)" }
        ], { duration: 220, easing: "ease-out" });
      }
    }

    function animateMove(routes, merges, spawnedIndex, gain, direction, largestBefore) {
      if (!motionEnabled()) { renderBoard(); return; }
      moving = true;
      const stepRevision = ++revision;
      const boxes = layout();
      const oldTiles = tiles;
      const nextTiles = new Map();
      const consumed = [];
      const slideDuration = 145;

      for (const route of routes) {
        const tile = oldTiles.get(route.from);
        const from = boxes[route.from];
        const to = boxes[route.to];
        // The outer tile slides; its inner face can squash independently on impact.
        for (const animation of tile.getAnimations({ subtree: true })) animation.cancel();
        place(tile, route.to);
        tile.style.zIndex = route.merging ? "3" : "2";
        if (!nextTiles.has(route.to)) nextTiles.set(route.to, tile);
        else consumed.push(tile);
        if (route.from !== route.to) {
          trail(route.value, from, to);
          animate(tile, [
            { transform: `translate(${from.x - to.x}px,${from.y - to.y}px)` },
            { transform: "translate(0,0)" }
          ], { duration: slideDuration, easing: "cubic-bezier(.2,.75,.25,1)" });
        }
      }

      slideTimer = setTimeout(() => {
        if (!alive || stepRevision !== revision) return;
        for (const tile of consumed) {
          tile.getAnimations().forEach((animation) => animation.cancel());
          tile.remove();
        }
        tiles = nextTiles;
        for (const [index, tile] of tiles) {
          tile.getAnimations().forEach((animation) => animation.cancel());
          setValue(tile, board[index]);
          tile.style.zIndex = "";
        }
        if (spawnedIndex >= 0) {
          const spawned = makeTile(board[spawnedIndex], spawnedIndex);
          tiles.set(spawnedIndex, spawned);
          appear(spawned);
        }
        if (merges.length) {
          const particleBudget = Math.floor(36 / merges.length);
          for (const merge of merges) {
            collision(tiles.get(merge.index), merge.value, direction);
            burst(merge.value, boxes[merge.index], particleBudget);
          }
          scoreFeedback(gain);
          announceMerge(merges, largestBefore, direction);
        }
        // Accept the next move as soon as sliding ends, while cosmetic effects
        // finish independently. Buffer the latest direction during the slide.
        moving = false;
        const nextDirection = pendingDirection;
        pendingDirection = null;
        if (nextDirection) move(nextDirection);
      }, slideDuration);
    }

    function move(direction) {
      if (!alive || ended) return;
      if (moving) { pendingDirection = direction; return; }
      const previous = [...board];
      const previousScore = points;
      const largestBefore = Math.max(...previous);
      const routes = []; const merges = [];

      for (let line = 0; line < 4; line++) {
        const indices = Array.from({ length: 4 }, (_, position) => {
          if (direction === "left") return line * 4 + position;
          if (direction === "right") return line * 4 + 3 - position;
          if (direction === "up") return position * 4 + line;
          return (3 - position) * 4 + line;
        });
        const occupied = indices.filter((index) => board[index]).map((from) => ({ from, value: board[from] }));
        const result = [];
        for (let index = 0; index < occupied.length; index++) {
          const source = occupied[index];
          const target = indices[result.length];
          if (source.value === occupied[index + 1]?.value) {
            const value = source.value * 2;
            result.push(value); points += value;
            merges.push({ index: target, value });
            routes.push({ ...source, to: target, merging: true }, { ...occupied[index + 1], to: target, merging: true });
            index++;
          } else {
            result.push(source.value);
            routes.push({ ...source, to: target, merging: false });
          }
        }
        indices.forEach((index, position) => { board[index] = result[position] || 0; });
      }

      if (board.every((value, index) => value === previous[index])) {
        if (!canMove()) { ended = true; message("这一局已结束，点击「重新开始」再来一局。"); save(); }
        return;
      }
      undo = { board: previous, score: previousScore, won, mergeStreak };
      mergeStreak = merges.length ? mergeStreak + 1 : 0;
      const spawnedIndex = spawn();
      const justWon = !won && board.some((value) => value >= 2048);
      if (justWon) { won = true; message("2048 达成！你可以继续，看看下一次翻倍。", true); tone(880, .2); }
      else { message(merges.length > 1 ? `一步合成 ${merges.length} 组，收获 +${points - previousScore} 分。` : "把相同的数字，推向彼此。"); tone(merges.length ? 620 : 350, .04); }
      if (!canMove()) { ended = true; message(`本局 ${points.toLocaleString()} 分。再来一局，打破自己的纪录。`); }
      updateStats(); save();
      animateMove(routes, merges, spawnedIndex, points - previousScore, direction, largestBefore);
    }

    function undoMove() {
      if (!undo || !alive) return;
      cancelMotion();
      board = undo.board; points = undo.score; won = undo.won; mergeStreak = undo.mergeStreak;
      undo = null; ended = false;
      message("已撤销上一步。换个方向试试看。");
      renderBoard(true); save();
    }
    undoButton.addEventListener("click", undoMove);

    function restart() {
      cancelMotion();
      board = Array(16).fill(0); points = 0; undo = null; ended = false; won = false; mergeStreak = 0;
      spawn(); spawn(); renderBoard(true); save();
      message("把相同的数字，推向彼此。");
    }

    function settle() {
      if (!alive) return;
      cancelMotion();
      renderBoard();
    }

    if (state.save2048) {
      board = [...state.save2048.board]; points = state.save2048.score;
      won = board.some((value) => value >= 2048); ended = !canMove();
      renderBoard(true);
      message(ended ? "这一局已经结束，重新开始吧。" : "已接上你的上一局，继续翻倍吧。");
    } else restart();

    swipe(boardElement, move, abort.signal);
    reducedMotion.addEventListener("change", settle, { signal: abort.signal });
    let lastWidth = boardElement.clientWidth;
    const resize = typeof ResizeObserver === "function" ? new ResizeObserver(() => {
      const width = boardElement.clientWidth;
      if (width !== lastWidth) { lastWidth = width; settle(); }
    }) : null;
    resize?.observe(boardElement);

    return {
      restart,
      focus: () => boardElement.focus({ preventScroll: true }),
      pause: settle,
      key(event) {
        const direction = directions(event.key);
        if (direction) { event.preventDefault(); move(direction); }
        if (event.key.toLowerCase() === "u") { event.preventDefault(); undoMove(); }
      },
      destroy() {
        save(); cancelMotion(); alive = false;
        abort.abort(); resize?.disconnect();
        scorePanel.classList.remove("score-panel-2048");
      }
    };
  }

  function createSnake() {
    const abort = new AbortController();
    const canvas = document.createElement("canvas"); canvas.className = "snake-board"; canvas.width = 600; canvas.height = 600; canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", "贪吃蛇游戏棋盘，方向键转向，空格暂停"); canvas.setAttribute("role", "img");
    $("#gameStage").append(canvas);
    const context = canvas.getContext("2d");
    if (!context) { message("当前浏览器无法创建游戏画布，请尝试其他游戏。"); return { restart() {}, destroy() {} }; }
    const tools = document.createElement("div"); tools.className = "snake-tools";
    const toggle = document.createElement("button"); tools.append(toggle); $("#gameStage").append(tools);
    let snake; let direction; let next; let food; let points; let timer; let started; let paused; let ended;
    function placeFood() {
      const empty = [];
      for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) if (!snake.some((cell) => cell.x === x && cell.y === y)) empty.push({ x, y });
      food = empty.length ? empty[Math.floor(Math.random() * empty.length)] : null;
    }
    function draw() {
      const palette = getComputedStyle(document.documentElement);
      context.clearRect(0, 0, 600, 600);
      context.fillStyle = palette.getPropertyValue("--line").trim();
      for (let x = 15; x < 600; x += 30) for (let y = 15; y < 600; y += 30) { context.beginPath(); context.arc(x, y, 1.6, 0, Math.PI * 2); context.fill(); }
      const ink = palette.getPropertyValue("--ink").trim();
      snake.forEach((cell, index) => {
        context.fillStyle = index === 0 ? palette.getPropertyValue("--green").trim() : ink;
        context.globalAlpha = index === 0 ? 1 : Math.max(.35, .75 - index * .009);
        context.beginPath(); context.roundRect(cell.x * 30 + 2, cell.y * 30 + 2, 26, 26, index === 0 ? 9 : 6); context.fill();
      });
      context.globalAlpha = 1;
      if (food) {
        context.fillStyle = palette.getPropertyValue("--accent").trim();
        context.beginPath(); context.arc(food.x * 30 + 15, food.y * 30 + 15, 10, 0, Math.PI * 2); context.fill();
      }
      if (!started || paused || ended) {
        context.fillStyle = palette.getPropertyValue("--panel-2").trim(); context.fillRect(0, 0, 600, 600);
        context.fillStyle = ink; context.textAlign = "center"; context.font = '600 32px "Segoe UI", sans-serif';
        context.fillText(ended ? "这一局，收获满满。" : !started ? "READY TO SNAKE?" : "休息一下。", 300, 285);
        context.font = '21px "Segoe UI", sans-serif'; context.fillText(ended ? "点击重新开始，再出发。" : "按方向键 / 空格 / 开始继续", 300, 328);
      }
      canvas.setAttribute("aria-label", `贪吃蛇，${points} 分，${ended ? "已结束" : paused ? "已暂停" : started ? "进行中" : "等待开始"}`);
    }
    function stop() { clearInterval(timer); timer = null; }
    function startTimer() { stop(); timer = setInterval(tick, Math.max(72, 155 - Math.floor(points / 30) * 8)); }
    function tick() {
      direction = next;
      const head = { x: snake[0].x + direction.x, y: snake[0].y + direction.y };
      const eating = food && head.x === food.x && head.y === food.y;
      const body = eating ? snake : snake.slice(0, -1);
      if (head.x < 0 || head.x >= 20 || head.y < 0 || head.y >= 20 || body.some((part) => part.x === head.x && part.y === head.y)) {
        ended = true; stop(); toggle.textContent = "再来一局"; best(points); draw(); message(`本局 ${points} 分。下一局，拐个好弯。`); tone(180, .18); return;
      }
      snake.unshift(head);
      if (eating) {
        points += 10; score(points); best(points); placeFood(); tone(650);
        if (!food) { ended = true; stop(); toggle.textContent = "再来一局"; draw(); message("填满整个棋盘，完美通关！", true); return; }
        startTimer();
      } else snake.pop();
      draw();
    }
    function pause() {
      if (!started || paused || ended) return;
      paused = true; stop(); toggle.textContent = "继续游戏"; draw(); message("已暂停，准备好再继续。");
    }
    function resume() {
      if (ended) restart();
      started = true; paused = false; toggle.textContent = "暂停 · 空格"; startTimer(); draw(); message("把快乐，一口一口收集起来。");
    }
    function turn(value) {
      const candidate = ({ left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, up: { x: 0, y: -1 }, down: { x: 0, y: 1 } })[value];
      if (ended) return;
      if (candidate.x === -direction.x && candidate.y === -direction.y) return;
      next = candidate;
      if (!started || paused) resume();
    }
    controls(tools, turn);
    toggle.addEventListener("click", () => !started || paused || ended ? resume() : pause());
    function restart() {
      stop(); snake = [{ x: 8, y: 10 }, { x: 7, y: 10 }, { x: 6, y: 10 }]; direction = { x: 1, y: 0 }; next = direction;
      points = 0; started = false; paused = false; ended = false; placeFood(); score(0); toggle.textContent = "开始游戏"; message("按方向键、滑动，或点击开始。"); draw();
    }
    swipe(canvas, turn, abort.signal); restart();
    return { restart, pause, redraw: draw, focus: () => canvas.focus({ preventScroll: true }), key(event) {
      const value = directions(event.key);
      if (value) { event.preventDefault(); turn(value); }
      if (event.code === "Space") { event.preventDefault(); if (!event.repeat) !started || paused || ended ? resume() : pause(); }
    }, destroy() { stop(); abort.abort(); } };
  }

  function createMemory() {
    const board = document.createElement("div"); board.className = "memory-board";
    $("#gameStage").append(board);
    const symbols = ["✳", "◈", "☀", "☾", "✿", "♧", "♡", "⌘"];
    let cards; let open = []; let matched = 0; let moves = 0; let locked = false; let timeout; let elapsed = 0; let startedAt = null; let timer;
    function showProgress() {
      if (startedAt !== null) elapsed = Math.floor((performance.now() - startedAt) / 1000);
      message(`已配对 ${matched} / 8 组 · 用时 ${elapsed} 秒`);
    }
    function flip(index) {
      const card = cards[index];
      if (locked || card.matched || open.includes(index)) return;
      if (startedAt === null) { startedAt = performance.now(); timer = setInterval(showProgress, 1000); }
      open.push(index); card.button.classList.add("flipped"); card.button.setAttribute("aria-label", `第 ${index + 1} 张：${card.symbol}`); card.button.setAttribute("aria-pressed", "true"); tone(420);
      if (open.length < 2) return;
      moves++; score(moves);
      const [first, second] = open;
      if (cards[first].symbol === cards[second].symbol) {
        open = []; matched++;
        for (const target of [cards[first], cards[second]]) {
          target.matched = true; target.button.classList.add("matched"); target.button.setAttribute("aria-disabled", "true");
          target.button.setAttribute("aria-label", `已配对：${target.symbol}`);
        }
        tone(790, .12);
        if (matched === 8) { clearInterval(timer); best(moves); message(`全部配对！${moves} 次翻牌，用时 ${Math.floor((performance.now() - startedAt) / 1000)} 秒。`, true); }
        else showProgress();
      } else {
        locked = true;
        timeout = setTimeout(() => {
          for (const target of open) {
            cards[target].button.classList.remove("flipped"); cards[target].button.setAttribute("aria-label", `翻开第 ${target + 1} 张卡片`); cards[target].button.setAttribute("aria-pressed", "false");
          }
          open = []; locked = false;
        }, 850);
        showProgress();
      }
    }
    function restart() {
      clearTimeout(timeout); clearInterval(timer); open = []; matched = 0; moves = 0; locked = false; elapsed = 0; startedAt = null;
      const deck = [...symbols, ...symbols];
      for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
      board.replaceChildren();
      cards = deck.map((symbol, index) => {
        const button = document.createElement("button"); button.className = "memory-tile"; button.setAttribute("aria-label", `翻开第 ${index + 1} 张卡片`); button.setAttribute("aria-pressed", "false");
        const inner = document.createElement("span"); inner.className = "memory-tile-inner"; inner.setAttribute("aria-hidden", "true");
        const back = document.createElement("span"); back.className = "memory-back"; back.textContent = "l.";
        const front = document.createElement("span"); front.className = "memory-front"; front.textContent = symbol;
        inner.append(back, front); button.append(inner); button.addEventListener("click", () => flip(index)); board.append(button);
        return { symbol, button, matched: false };
      });
      score(0); message("翻开第一张，记住那个小小的图案。");
    }
    restart();
    return { restart, focus: () => cards[0].button.focus({ preventScroll: true }), destroy() { clearTimeout(timeout); clearInterval(timer); } };
  }

  function createReaction() {
    const target = document.createElement("button"); target.className = "reaction-target"; $("#gameStage").append(target);
    const symbol = document.createElement("span"); symbol.className = "reaction-symbol"; symbol.setAttribute("aria-hidden", "true");
    const title = document.createElement("strong"); const subtitle = document.createElement("small"); target.append(symbol, title, subtitle);
    let phase = "idle"; let timeout; let frame; let greenAt = 0; let rounds = [];
    function render(mode, heading, detail, icon) {
      phase = mode; target.className = `reaction-target ${mode}`;
      title.textContent = heading; subtitle.textContent = detail; symbol.textContent = icon;
    }
    function clear() { clearTimeout(timeout); cancelAnimationFrame(frame); }
    function wait() {
      clear();
      render("waiting", "等一下……", "绿色出现后立刻点击，不要抢跑。", "···");
      message(`第 ${rounds.length + 1} / 5 轮 · 保持专注`);
      timeout = setTimeout(() => {
        // Establish the start on the frame that presents the green target.
        frame = requestAnimationFrame(() => {
          render("ready", "就是现在！", "点击 / 轻触 / 按空格", "↯");
          greenAt = performance.now();
        });
      }, 1600 + Math.random() * 2800);
    }
    function activate() {
      if (phase === "waiting") {
        clear(); render("early", "抢跑啦。", "放轻松，点击重新开始这一轮。", "↺"); tone(180, .12); return;
      }
      if (phase === "ready") {
        const milliseconds = Math.max(1, Math.round(performance.now() - greenAt));
        rounds.push(milliseconds); score(`${milliseconds} ms`); best(milliseconds); tone(780, .12);
        if (rounds.length >= 5) {
          const average = Math.round(rounds.reduce((sum, value) => sum + value, 0) / rounds.length);
          render("finished", `${average} ms`, `5 轮平均 · 最快 ${Math.min(...rounds)} ms · 点击再来一组`, "✳");
          message(`五轮完成。每一次专注，都比上一次更接近。`, true);
        } else {
          render("result", `${milliseconds} ms`, `已完成 ${rounds.length} / 5 轮 · 点击继续`, "✦");
          message(milliseconds < 250 ? "好快，反应非常敏锐。" : "不错，下一轮再快一点。", milliseconds < 250);
        }
        return;
      }
      if (phase === "finished") rounds = [];
      wait();
    }
    function restart() { clear(); rounds = []; score("—"); render("idle", "准备好了吗？", "点击这里开始 · 绿色出现时立刻反应", "↯"); message("不靠预判，只凭反应。"); }
    target.addEventListener("pointerdown", (event) => { if (event.button === 0) { event.preventDefault(); target.focus({ preventScroll: true }); activate(); } });
    target.addEventListener("click", (event) => { if (event.detail === 0) activate(); });
    restart();
    return { restart, focus: () => target.focus({ preventScroll: true }), key(event) {
      if (event.code === "Space" || event.key === "Enter") { event.preventDefault(); if (!event.repeat) activate(); }
    }, pause() {
      if (phase === "waiting" || phase === "ready") { clear(); render("idle", "准备好，再开始。", "已暂停本轮，避免切换窗口影响计时。", "↺"); message(`已完成 ${rounds.length} / 5 轮`); }
    }, destroy: clear };
  }

  let headlineTimer;
  function typeHeadline() {
    clearTimeout(headlineTimer);
    const target = $("#typedHeadline");
    const phrases = ["PRESS PLAY.", "MAKE A MOVE.", "JUST ONE MORE.", "PLAY A LITTLE."];
    if (reducedMotion.matches) { target.textContent = phrases[0]; return; }
    let index = 0; let count = phrases[0].length; let deleting = true;
    function tick() {
      if (document.hidden || dialog.open) { headlineTimer = setTimeout(tick, 700); return; }
      const phrase = phrases[index];
      count += deleting ? -1 : 1;
      target.textContent = phrase.slice(0, Math.max(0, count));
      let delay = deleting ? 38 : 60 + Math.random() * 50;
      if (!deleting && count >= phrase.length) { deleting = true; delay = 2700; }
      else if (deleting && count <= 0) { deleting = false; index = (index + 1) % phrases.length; delay = 320; }
      headlineTimer = setTimeout(tick, delay);
    }
    headlineTimer = setTimeout(tick, 3100);
  }
  function opening() {
    const element = $("#opening");
    if (reducedMotion.matches) return;
    // Nothing blocks the page by default, even if an initialization step fails.
    element.classList.add("running");
    document.body.classList.add("motion-ready");
    setTimeout(() => element.remove(), 1750);
  }
  reducedMotion.addEventListener("change", typeHeadline);
  clock(); setInterval(() => { if (!document.hidden) clock(); }, 15000);
  renderFavorites(); renderRecords(); filterGames(); updateTheme(); opening(); typeHeadline();
  window.LumonPlay = {
    toast, open: openGame,
    refresh: () => { renderFavorites(); renderRecords(); filterGames(); },
    setFilter(value) { filter = value; filterGames(); },
    register(items) {
      for (const item of items) {
        if (!/^game_[a-f0-9-]{36}$/.test(item.id)) continue;
        games[item.id] = { ...item, community: true, icon: "✦", scoreLabel: "", bestLabel: "",
          help: item.instructions || "按游戏中的说明操作。点击右上角退出，返回游戏大厅。" };
      }
      renderFavorites(); renderRecords(); filterGames();
    },
    reconcile(ids) {
      const available = new Set(ids);
      for (const [id, game] of Object.entries(games)) {
        if (game.community && !available.has(id)) {
          if (currentId === id) dialog.close();
          delete games[id];
        }
      }
      renderFavorites(); renderRecords(); filterGames();
    },
    remove(id) {
      if (!games[id]?.community) return;
      if (currentId === id) dialog.close();
      delete games[id];
      state.favorites = state.favorites.filter((value) => value !== id);
      state.recent = state.recent.filter((item) => item.id !== id);
      persist(); renderRecords(); filterGames();
    }
  };
  const requested = new URLSearchParams(location.search).get("game");
  if (games[requested]) setTimeout(() => openGame(requested), reducedMotion.matches ? 0 : 1700);
})();
