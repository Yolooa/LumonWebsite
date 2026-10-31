/*
 * Lumon cloud adapter
 *
 * Cloudflare Pages Functions contract:
 *   GET    /api/session              -> { success, user }
 *   POST   /api/login                -> PBKDF2 login + signed HttpOnly session
 *   POST   /api/register             -> PBKDF2 registration + signed session
 *   POST   /api/logout               -> { success }
 *   GET    /api/todos                -> { success, todos }
 *   POST   /api/todos                -> { success, todo }
 *   PATCH  /api/todos/:id            -> { success, todo }
 *   DELETE /api/todos/:id            -> { success }
 *   GET    /api/aggregation          -> { success, total, counts, items }
 *   POST   /api/aggregation/sync     -> { success, total, counts, items }
 *   GET    /api/notifications        -> { success, unread, notifications }
 *   POST   /api/notifications/read   -> { success }
 *   GET    /api/personal/notes       -> { success, notes }
 *   PATCH  /api/personal/notes/:key  -> { success, note }
 *   GET    /api/personal/daily-note  -> { success, note }
 *   PATCH  /api/personal/daily-note  -> { success, note }
 *   GET    /api/messages/conversations -> { success, conversations }
 *   GET    /api/messages/:id         -> { success, messages }
 *   POST   /api/messages/:id         -> { success, message }
 *   GET    /api/users/lookup?query=  -> { success, found, user }
 *   GET    /api/friends              -> { success, friends }
 *   GET    /api/friends/requests     -> { success, requests, outgoing }
 *   POST   /api/friends              -> { success, request, pending }
 *   POST   /api/friends/requests/accept
 *   POST   /api/friends/requests/reject
 *   POST   /api/messages/groups      -> { success, conversation }
 *
 * The frontend can be deployed before those data routes exist. In that case
 * it keeps an API-shaped local cache and exposes an explicit offline state.
 */
(() => {
  "use strict";

  const config = Object.assign(
    {
      apiBase: "/api",
      sessionKey: "pellosy.session.v1",
      timeout: 12000
    },
    window.PELLOSY_CLOUD_CONFIG || {}
  );

  const guest = Object.freeze({
    id: "",
    name: "访客",
    username: "",
    email: "",
    guest: true
  });

  function safeParse(value) {
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  function readStorage(storage, key) {
    try {
      return storage.getItem(key);
    } catch {
      return null;
    }
  }

  function writeStorage(storage, key, value) {
    try {
      storage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  function removeStorage(storage, key) {
    try {
      storage.removeItem(key);
    } catch {
      return;
    }
  }

  function normalizeUser(input) {
    const raw = input || {};
    const sourceName =
      raw.displayName ||
      raw.display_name ||
      raw.nickname ||
      raw.name ||
      raw.username ||
      "";
    const name = String(sourceName).trim().slice(0, 64);
    const username = String(raw.username || name).trim().slice(0, 64);
    return {
      id: String(raw.id || raw.userId || raw.user_id || username || ""),
      name: name || guest.name,
      username,
      email: String(raw.email || "").trim().slice(0, 160),
      guest: Boolean(raw.guest) || !username
    };
  }

  function getCachedUser() {
    const raw =
      readStorage(localStorage, config.sessionKey) ||
      readStorage(sessionStorage, config.sessionKey);
    const session = safeParse(raw);
    if (!session) return { ...guest };
    return normalizeUser(session.user || session);
  }

  function setCachedUser(user, remember = true) {
    const normalized = normalizeUser(user);
    const payload = JSON.stringify(normalized);
    if (remember) {
      removeStorage(sessionStorage, config.sessionKey);
      writeStorage(localStorage, config.sessionKey, payload);
    } else {
      removeStorage(localStorage, config.sessionKey);
      writeStorage(sessionStorage, config.sessionKey, payload);
    }
    return normalized;
  }

  function clearCachedUser() {
    removeStorage(localStorage, config.sessionKey);
    removeStorage(sessionStorage, config.sessionKey);
  }

  function initials(name) {
    const value = String(name || "").trim();
    if (!value) return "?";
    const words = value.split(/\s+/).filter(Boolean);
    if (words.length > 1) {
      return words
        .slice(0, 2)
        .map((word) => [...word][0])
        .join("")
        .toUpperCase();
    }
    return [...value].slice(0, 2).join("").toUpperCase();
  }

  function emit(type, detail) {
    window.dispatchEvent(new CustomEvent(type, { detail }));
  }

  async function request(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      Number(options.timeout) || config.timeout
    );
    const method = options.method || "GET";
    const headers = {
      Accept: "application/json",
      ...(options.headers || {})
    };
    const init = {
      method,
      credentials: "include",
      headers,
      signal: controller.signal,
      cache: "no-store"
    };

    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }

    try {
      const response = await fetch(
        `${config.apiBase}${path.startsWith("/") ? path : `/${path}`}`,
        init
      );
      const contentType = response.headers.get("content-type") || "";
      const data = contentType.includes("application/json")
        ? await response.json()
        : { message: await response.text() };
      if (!response.ok || data.success === false) {
        const error = new Error(
          data.message || data.error || `请求失败 (${response.status})`
        );
        error.status = response.status;
        error.code = data.code || "";
        throw error;
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  function normalizeTodo(input) {
    const raw = input || {};
    return {
      id: String(raw.id || raw.todoId || raw.todo_id || `local-${crypto.randomUUID()}`),
      title: String(raw.title || raw.text || raw.content || "未命名待办").slice(0, 120),
      meta: String(raw.meta || raw.category || raw.project || "Personal task").slice(0, 80),
      done: Boolean(raw.done ?? raw.completed ?? raw.is_done),
      time: String(raw.time || raw.dueTime || raw.due_time || "").slice(0, 16),
      pending: Boolean(raw.pending)
    };
  }

  function normalizeSignal(input) {
    const raw = input || {};
    return {
      id: String(raw.id || raw.signalId || raw.signal_id || crypto.randomUUID()),
      title: String(raw.title || raw.name || raw.content || "云端信号").slice(0, 140),
      detail: String(raw.detail || raw.description || raw.source || "").slice(0, 160),
      kind: ["inbox", "idea", "file"].includes(raw.kind || raw.source)
        ? raw.kind || raw.source
        : "inbox",
      time: String(raw.time || raw.relativeTime || raw.updated_at || "").slice(0, 32)
    };
  }

  function normalizeAggregation(data) {
    const raw = data || {};
    const items = Array.isArray(raw) ? raw : raw.items || raw.signals || [];
    const normalizedItems = items.map(normalizeSignal);
    const counts = {
      all: normalizedItems.length,
      inbox: normalizedItems.filter((item) => item.kind === "inbox").length,
      idea: normalizedItems.filter((item) => item.kind === "idea").length,
      file: normalizedItems.filter((item) => item.kind === "file").length
    };
    Object.assign(counts, raw.counts || {});
    return {
      total: Number(raw.total ?? counts.all) || 0,
      counts,
      items: normalizedItems
    };
  }

  function normalizeNotification(input) {
    const raw = input || {};
    return {
      id: String(raw.id || crypto.randomUUID()),
      title: String(raw.title || "新通知").slice(0, 140),
      detail: String(raw.detail || raw.message || raw.description || "").slice(0, 240),
      kind: String(raw.kind || raw.type || "system").slice(0, 32),
      time: String(raw.time || raw.relativeTime || raw.created_at || "").slice(0, 48),
      read: Boolean(raw.read),
      url: String(raw.url || "").slice(0, 500)
    };
  }

  function normalizeConversation(input) {
    const raw = input || {};
    const members = Array.isArray(raw.members)
      ? raw.members.map((member) => ({
          id: String(member.id || member.userId || member.user_id || ""),
          name: String(member.name || member.displayName || member.username || "用户").slice(0, 64)
        }))
      : [];
    return {
      id: String(raw.id || raw.conversationId || raw.conversation_id || crypto.randomUUID()),
      type: raw.type === "group" ? "group" : "direct",
      title: String(raw.title || raw.name || members.map((member) => member.name).join("、") || "对话").slice(0, 80),
      members,
      lastMessage: String(raw.lastMessage || raw.last_message || "").slice(0, 240),
      unread: Number(raw.unread || 0),
      updatedAt: String(raw.updatedAt || raw.updated_at || "")
    };
  }

  function normalizeMessage(input) {
    const raw = input || {};
    return {
      id: String(raw.id || crypto.randomUUID()),
      conversationId: String(raw.conversationId || raw.conversation_id || ""),
      senderId: String(raw.senderId || raw.sender_id || ""),
      senderName: String(raw.senderName || raw.sender_name || "用户").slice(0, 64),
      text: String(raw.text || raw.content || "").slice(0, 4000),
      createdAt: String(raw.createdAt || raw.created_at || ""),
      mine: Boolean(raw.mine)
    };
  }

  async function loadSession() {
    try {
      const data = await request("/session", { timeout: 4500 });
      if (data.user) {
        const user = setCachedUser(data.user);
        emit("pellosy:session", user);
        return user;
      }
      clearCachedUser();
      const guestUser = { ...guest };
      emit("pellosy:session", guestUser);
      return guestUser;
    } catch (error) {
      if (error?.status === 401) {
        clearCachedUser();
        const guestUser = { ...guest };
        emit("pellosy:session", guestUser);
        return guestUser;
      }
    }
    const cached = getCachedUser();
    emit("pellosy:session", cached);
    return cached;
  }

  async function login(payload, remember = true) {
    const data = await request("/login", {
      method: "POST",
      body: {
        identifier: payload.identifier,
        username: payload.username || payload.identifier,
        password: payload.password,
        remember: remember !== false,
        turnstileToken: payload.turnstileToken || ""
      }
    });
    const user = setCachedUser(
      {
        id: data.user?.id || data.userId || data.username,
        username: data.user?.username || data.username || payload.identifier,
        name:
          data.user?.displayName ||
          data.user?.display_name ||
          data.user?.name ||
          data.username ||
          payload.identifier,
        email: data.user?.email || data.email || ""
      },
      remember
    );
    emit("pellosy:session", user);
    return user;
  }

  async function register(payload, remember = true) {
    const data = await request("/register", {
      method: "POST",
      body: {
        username: payload.username,
        email: payload.email || "",
        password: payload.password,
        remember: remember !== false,
        turnstileToken: payload.turnstileToken || ""
      }
    });
    const user = setCachedUser(
      {
        id: data.user?.id || data.userId || data.username || payload.username,
        username: data.user?.username || data.username || payload.username,
        name:
          data.user?.displayName ||
          data.user?.display_name ||
          data.user?.name ||
          data.username ||
          payload.username,
        email: data.user?.email || data.email || payload.email || ""
      },
      remember
    );
    emit("pellosy:session", user);
    return user;
  }

  async function logout() {
    try {
      await request("/logout", { method: "POST", body: {} });
    } catch {
      /* Local logout must still succeed while the API is offline. */
    } finally {
      clearCachedUser();
      emit("pellosy:session", { ...guest });
    }
  }

  async function listTodos() {
    const data = await request("/todos");
    const todos = Array.isArray(data) ? data : data.todos || data.items || [];
    return todos.map(normalizeTodo);
  }

  async function createTodo(todo) {
    const data = await request("/todos", {
      method: "POST",
      body: {
        title: todo.title,
        meta: todo.meta || "Personal task",
        time: todo.time || ""
      }
    });
    return normalizeTodo(data.todo || data);
  }

  async function updateTodo(id, patch) {
    const data = await request(`/todos/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: patch
    });
    return normalizeTodo(data.todo || data);
  }

  async function deleteTodo(id) {
    await request(`/todos/${encodeURIComponent(id)}`, { method: "DELETE" });
    return true;
  }

  async function getAggregation() {
    return normalizeAggregation(await request("/aggregation"));
  }

  async function syncAggregation() {
    return normalizeAggregation(
      await request("/aggregation/sync", { method: "POST", body: {} })
    );
  }

  async function updateProfile(patch) {
    const data = await request("/profile", {
      method: "PATCH",
      body: patch
    });
    const user = setCachedUser(data.user || { ...getCachedUser(), ...patch });
    emit("pellosy:session", user);
    return user;
  }

  async function getNotifications() {
    const data = await request("/notifications");
    const items = Array.isArray(data) ? data : data.notifications || data.items || [];
    return {
      unread: Number(data.unread ?? items.filter((item) => !item.read).length),
      items: items.map(normalizeNotification)
    };
  }

  async function markNotificationsRead() {
    await request("/notifications/read", { method: "POST", body: {} });
    return true;
  }

  async function getPersonalNotes() {
    const data = await request("/personal/notes");
    return data.notes || data.data || {};
  }

  async function savePersonalNote(key, text) {
    const data = await request(`/personal/notes/${encodeURIComponent(key)}`, {
      method: "PATCH",
      body: { text }
    });
    return data.note || { key, text, updatedAt: new Date().toISOString() };
  }

  async function getDailyNote() {
    const data = await request("/personal/daily-note");
    return data.note || { text: "", updatedAt: "" };
  }

  async function saveDailyNote(text) {
    const data = await request("/personal/daily-note", {
      method: "PATCH",
      body: { text }
    });
    return data.note || { text, updatedAt: new Date().toISOString() };
  }

  async function getConversations() {
    const data = await request("/messages/conversations");
    const items = Array.isArray(data) ? data : data.conversations || [];
    return items.map(normalizeConversation);
  }

  async function getMessages(conversationId) {
    const data = await request(`/messages/${encodeURIComponent(conversationId)}`);
    const items = Array.isArray(data) ? data : data.messages || [];
    return items.map(normalizeMessage);
  }

  async function sendMessage(conversationId, text) {
    const data = await request(`/messages/${encodeURIComponent(conversationId)}`, {
      method: "POST",
      body: { text }
    });
    return normalizeMessage(data.message || data);
  }

  function normalizeFriendRequest(input, incoming = true) {
    const raw = input || {};
    const user = raw.user || raw.requester || raw.sender || raw;
    return {
      id: String(raw.id || `${user.id || ""}:${incoming ? "in" : "out"}`),
      user: {
        id: String(user.id || user.userId || user.user_id || ""),
        username: String(user.username || "").slice(0, 64),
        name: String(user.name || user.displayName || user.display_name || user.username || "用户").slice(0, 64)
      },
      createdAt: String(raw.createdAt || raw.created_at || ""),
      incoming: raw.incoming === undefined ? Boolean(incoming) : Boolean(raw.incoming)
    };
  }

  async function sendFriendRequest(friendId) {
    const data = await request("/friends", {
      method: "POST",
      body: { friendId }
    });
    return {
      pending: true,
      message: String(data.message || "好友申请已发送"),
      request: normalizeFriendRequest(data.request, false)
    };
  }

  async function listFriendRequests() {
    const data = await request("/friends/requests");
    const incoming = data.requests || data.incoming || [];
    const outgoing = data.outgoing || [];
    return {
      count: Number(data.count ?? incoming.length) || 0,
      incoming: incoming.map((item) => normalizeFriendRequest(item, true)),
      outgoing: outgoing.map((item) => normalizeFriendRequest(item, false))
    };
  }

  async function acceptFriendRequest(requesterId) {
    const data = await request("/friends/requests/accept", {
      method: "POST",
      body: { requesterId }
    });
    return {
      friend: data.friend || { id: requesterId },
      conversation: data.conversation
        ? normalizeConversation(data.conversation)
        : null
    };
  }

  async function rejectFriendRequest(requesterId) {
    await request("/friends/requests/reject", {
      method: "POST",
      body: { requesterId }
    });
    return true;
  }

  async function lookupFriend(query) {
    const data = await request(`/users/lookup?query=${encodeURIComponent(query)}`);
    return {
      found: Boolean(data.found),
      user: data.user || null
    };
  }

  async function listFriends() {
    const data = await request("/friends");
    const items = Array.isArray(data) ? data : data.friends || [];
    return items.map((friend) => ({
      id: String(friend.id || friend.userId || friend.username || ""),
      username: String(friend.username || "").slice(0, 64),
      name: String(friend.name || friend.displayName || friend.username || "好友").slice(0, 64)
    }));
  }

  async function executeCode(payload) {
    const data = await request("/execute", {
      method: "POST",
      body: {
        language: payload.language,
        content: payload.content,
        stdin: payload.stdin || "",
        provider: payload.provider || "auto"
      },
      timeout: 26000
    });
    return {
      language: String(data.language || payload.language || ""),
      provider: String(data.provider || ""),
      version: String(data.version || ""),
      compileOutput: String(data.compileOutput || ""),
      compileCode: Number(data.compileCode || 0),
      stdout: String(data.stdout || ""),
      stderr: String(data.stderr || ""),
      output: String(data.output || ""),
      exitCode: Number(data.exitCode || 0),
      signal: String(data.signal || "")
    };
  }

  async function executionStatus(probe = false) {
    const data = await request(`/execute/status${probe ? "?probe=1" : ""}`, {
      timeout: probe ? 14000 : 8000
    });
    return {
      provider: String(data.provider || ""),
      local: data.local || false,
      remote: data.remote || {},
      wandboxUrl: String(data.wandboxUrl || ""),
      pistonUrl: String(data.pistonUrl || "")
    };
  }

  async function createGroup(payload) {
    const data = await request("/messages/groups", {
      method: "POST",
      body: {
        name: payload.name,
        memberIds: payload.memberIds
      }
    });
    return normalizeConversation(data.conversation || data);
  }

  window.PellosyCloud = {
    config,
    guest,
    initials,
    getCachedUser,
    setCachedUser,
    clearCachedUser,
    loadSession,
    login,
    register,
    logout,
    updateProfile,
    todos: {
      list: listTodos,
      create: createTodo,
      update: updateTodo,
      remove: deleteTodo
    },
    aggregation: {
      get: getAggregation,
      sync: syncAggregation
    },
    notifications: {
      list: getNotifications,
      markAllRead: markNotificationsRead
    },
    personal: {
      getNotes: getPersonalNotes,
      saveNote: savePersonalNote,
      getDailyNote,
      saveDailyNote
    },
    messages: {
      conversations: getConversations,
      list: getMessages,
      send: sendMessage,
      createGroup
    },
    friends: {
      lookup: lookupFriend,
      list: listFriends,
      add: sendFriendRequest,
      sendRequest: sendFriendRequest,
      requests: listFriendRequests,
      accept: acceptFriendRequest,
      reject: rejectFriendRequest
    },
    execution: {
      run: executeCode,
      status: executionStatus
    },
    request
  };

  emit("pellosy:cloud-ready", window.PellosyCloud);
})();
