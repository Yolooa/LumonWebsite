(() => {
  "use strict";

  /*
   * Cloudflare Worker / Pages Functions 登录接口。
   * 如果接口地址不同，只修改这里即可。
   */
  const AUTH_ENDPOINT = "/api/auth/login";
  const AFTER_LOGIN_URL = "social2.html";

  const page = document.querySelector(".login-page");
  const form = document.querySelector("[data-login-form]");
  const submit = form?.querySelector("button[type='submit']");
  const submitLabel = document.querySelector("[data-submit-label]");
  const statusBox = document.querySelector("[data-form-status]");
  const toast = document.querySelector("[data-toast]");
  const themeMenu = document.querySelector("[data-theme-menu]");
  const passwordInput = document.querySelector("#login-password");

  const state = {
    submitting: false,
    toastTimer: null
  };

  function showToast(message) {
    if (!toast) {
      return;
    }

    toast.textContent = message;
    toast.classList.add("is-visible");

    window.clearTimeout(state.toastTimer);

    state.toastTimer = window.setTimeout(() => {
      toast.classList.remove("is-visible");
    }, 2600);
  }

  function showStatus(message, type = "error") {
    if (!statusBox) {
      return;
    }

    statusBox.hidden = false;
    statusBox.textContent = message;
    statusBox.classList.toggle(
      "is-success",
      type === "success"
    );
  }

  function clearStatus() {
    if (!statusBox) {
      return;
    }

    statusBox.hidden = true;
    statusBox.textContent = "";
    statusBox.classList.remove("is-success");
  }

  function setFieldError(name, message) {
    const error = document.querySelector(
      `[data-error-for="${name}"]`
    );

    if (error) {
      error.textContent = message;
    }

    const input = form?.elements[name];

    if (input) {
      input.setAttribute(
        "aria-invalid",
        message ? "true" : "false"
      );
    }
  }

  function clearFieldErrors() {
    setFieldError("identifier", "");
    setFieldError("password", "");
  }

  function validateForm() {
    clearFieldErrors();

    const identifier =
      form.elements.identifier.value.trim();

    const password =
      form.elements.password.value;

    let valid = true;

    if (!identifier) {
      setFieldError(
        "identifier",
        "请输入邮箱或用户名。"
      );
      valid = false;
    }

    if (!password) {
      setFieldError(
        "password",
        "请输入密码。"
      );
      valid = false;
    } else if (password.length < 6) {
      setFieldError(
        "password",
        "密码至少需要 6 个字符。"
      );
      valid = false;
    }

    return valid;
  }

  function getTurnstileToken() {
    const input = document.querySelector(
      "[name='cf-turnstile-response']"
    );

    return input?.value || "";
  }

  async function parseResponse(response) {
    const text = await response.text();

    if (!text) {
      return {};
    }

    try {
      return JSON.parse(text);
    } catch {
      return {
        message: text
      };
    }
  }

  async function login(payload) {
    const response = await fetch(AUTH_ENDPOINT, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await parseResponse(response);

    if (!response.ok) {
      throw new Error(
        data.error ||
        data.message ||
        "登录失败，请检查账户信息。"
      );
    }

    return data;
  }

  function setSubmitting(value) {
    state.submitting = value;

    if (submit) {
      submit.disabled = value;
    }

    if (submitLabel) {
      submitLabel.textContent = value
        ? "正在连接节点..."
        : "进入我的节点";
    }
  }

  function handleLoginSuccess(data) {
    showStatus(
      data.message || "身份验证成功，正在进入你的节点。",
      "success"
    );

    showToast("登录成功。");

    window.setTimeout(() => {
      window.location.href =
        data.redirect || AFTER_LOGIN_URL;
    }, 600);
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (state.submitting || !validateForm()) {
      return;
    }

    clearStatus();

    const formData = new FormData(form);

    const payload = {
      identifier: formData.get("identifier").trim(),
      password: formData.get("password"),
      remember: formData.get("remember") === "true",
      turnstileToken: getTurnstileToken()
    };

    setSubmitting(true);

    try {
      const data = await login(payload);
      handleLoginSuccess(data);
    } catch (error) {
      console.error("Login request failed:", error);

      showStatus(
        error.message ||
        "无法连接登录服务，请稍后再试。"
      );

      showToast("登录未完成。");
    } finally {
      setSubmitting(false);
    }
  }

  function togglePassword() {
    if (!passwordInput) {
      return;
    }

    const visible =
      passwordInput.type === "text";

    passwordInput.type = visible
      ? "password"
      : "text";

    const button = document.querySelector(
      "[data-password-toggle]"
    );

    if (button) {
      button.setAttribute(
        "aria-label",
        visible ? "显示密码" : "隐藏密码"
      );

      button.setAttribute(
        "title",
        visible ? "显示密码" : "隐藏密码"
      );

      button.textContent = visible
        ? "◉"
        : "◎";
    }
  }

  function setTheme(theme) {
    page.classList.remove(
      "theme-orbit",
      "theme-ember",
      "theme-paper"
    );

    page.classList.add(`theme-${theme}`);
    localStorage.setItem(
      "pellosy-login-theme",
      theme
    );
  }

  function bindEvents() {
    form?.addEventListener("submit", handleSubmit);

    document
      .querySelector("[data-password-toggle]")
      ?.addEventListener("click", togglePassword);

    document
      .querySelector("[data-theme-toggle]")
      ?.addEventListener("click", () => {
        if (themeMenu) {
          themeMenu.hidden = !themeMenu.hidden;
        }
      });

    document.addEventListener("click", (event) => {
      const theme = event.target.closest("[data-theme]");

      if (theme) {
        setTheme(theme.dataset.theme);

        if (themeMenu) {
          themeMenu.hidden = true;
        }

        return;
      }

      if (
        !event.target.closest("[data-theme-menu]") &&
        !event.target.closest("[data-theme-toggle]") &&
        themeMenu
      ) {
        themeMenu.hidden = true;
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && themeMenu) {
        themeMenu.hidden = true;
      }
    });

    form?.querySelectorAll("input").forEach((input) => {
      input.addEventListener("input", () => {
        setFieldError(input.name, "");
        clearStatus();
      });
    });
  }

  function init() {
    const savedTheme =
      localStorage.getItem("pellosy-login-theme");

    if (savedTheme) {
      setTheme(savedTheme);
    }

    bindEvents();
  }

  init();
})();