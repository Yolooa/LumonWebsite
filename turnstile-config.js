/*
 * turnstile-config.js — Cloudflare Turnstile 配置（登录 / 注册人机验证）
 * ---------------------------------------------------------------------------
 * 用法：把 Cloudflare 后台拿到的 **Site Key**（公开值）填到下面的 siteKey。
 * Secret Key（私密值）不能写在这里，要放到服务端环境变量：
 *   线上：Cloudflare Pages → Settings → Environment variables →
 *         TURNSTILE_SECRET_KEY = 你的 Secret Key
 *   本地：工作区根目录 .dev.vars 里加一行 TURNSTILE_SECRET_KEY=...
 *
 * 拿 Site Key / Secret Key 的路径：
 *   Cloudflare Dashboard → Turnstile → Add site →
 *   填你的域名（如 xxx.pages.dev 和自定义域名）→ 选 Managed 模式 →
 *   创建后会显示 Site Key 与 Secret Key。
 *
 * 想临时关掉「前端」验证（服务端仍会校验），把 enabled 改成 false。
 */

window.PELLOSY_TURNSTILE = Object.assign(
  {
    /* ← 把 Site Key 填这里，形如 "0x4AAAAAAAxxxxxxxxxxxxxxxx" */
    siteKey: "0x4AAAAAAFWSytUxjxrP9y06",

    /* 前端是否强制要求先通过验证 */
    enabled: true,

    /* 组件主题：dark / light / auto */
    theme: "dark",

    /* 校验令牌的服务端接口（本站已有，无需改动） */
    verifyEndpoint: "/api/submit"
  },

  /* 允许在加载本文件之前先给一份配置（便于本地联调 / 自动化测试覆写） */
  window.PELLOSY_TURNSTILE || {}
);
