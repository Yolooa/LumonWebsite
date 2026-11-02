(() => {
  "use strict";
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const world = document.createElement("div");
  world.className = "ps-world";
  world.setAttribute("aria-hidden", "true");
  // Code-native silhouettes keep the reveal independent of remote images.
  const consoleShape = `<svg viewBox="0 0 220 440" fill="none" xmlns="http://www.w3.org/2000/svg"><path class="ps5-core" d="M90 54Q116 43 139 63L151 381Q121 396 83 381Z"/><path class="ps5-wing" d="M84 34Q104 55 99 130L89 363Q92 391 66 408L40 398Q67 251 59 112Q58 60 47 24Q68 22 84 34Z"/><path class="ps5-wing" d="M139 47Q151 19 177 17Q160 97 167 203L185 397Q165 414 142 405Q133 351 136 239L129 105Q128 66 139 47Z"/><path class="ps5-seam" d="M86 49Q95 85 88 181L79 368M144 45Q133 89 143 200L154 382"/><path d="M68 409Q113 429 164 410L183 424Q123 443 49 424Z"/><path d="M149 324l20 4M111 303v15m0 17v5"/><circle cx="111" cy="354" r="2"/></svg>`;
  world.innerHTML = `<div class="ps-blue-field"></div><div class="ps-light-trail"></div><div class="ps-console ps-console-one">${consoleShape}</div><div class="ps-console ps-console-two">${consoleShape}</div><div class="ps-symbols"><span>△</span><span>○</span><span>×</span><span>□</span></div>`;
  const reveal = document.createElement("div");
  reveal.className = "ps-reveal";
  reveal.setAttribute("aria-hidden", "true");
  reveal.innerHTML = `<div class="ps-logo-halo"></div><div class="ps-logo-lockup"><svg class="ps-logo" viewBox="0 0 160 130" xmlns="http://www.w3.org/2000/svg"><g class="ps-logo-base"><path d="M63 89 31 100c-9 3-12 6-4 9 8 3 20 2 29-1l7-2v12c-17 5-34 4-48-1-17-6-20-15-5-21l53-18Z"/><path d="m96 80 39 12c22 7 26 16 5 24-13 5-30 5-45 1v-11c11 3 21 3 29 0 7-3 5-5-1-7L96 91Z"/></g><path class="ps-logo-p" d="M64 5v103l23 8V30l7 2c9 3 10 9 10 19v24c19 8 32 3 32-16 0-22-10-34-37-43Z"/></svg><span class="ps-wordmark">PlayStation</span><span class="ps-tagline">Play Has No Limits.</span></div>`;
  const status = document.createElement("span");
  status.className = "ps-sr-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  document.body.append(world, reveal, status);
  let active = false;
  let exitTimer;
  let removeTimer;
  let logoTimer;
  function finish() {
    clearTimeout(exitTimer); clearTimeout(removeTimer); clearTimeout(logoTimer);
    document.body.classList.remove("ps-active", "ps-logo-visible", "ps-departing");
    active = false;
    status.textContent = "彩蛋结束，已返回原来的主题。";
  }
  function depart() {
    if (!active) return;
    document.body.classList.remove("ps-logo-visible");
    document.body.classList.add("ps-departing");
    clearTimeout(exitTimer);
    removeTimer = setTimeout(finish, reduced.matches ? 250 : 1300);
  }
  window.LumonPlayStation = {
    activate() {
      if (active || document.querySelector("dialog[open]")) return;
      active = true;
      document.body.classList.add("ps-active", "ps-logo-visible");
      status.textContent = "PlayStation 彩蛋已开启。按 Escape 可提前返回。";
      logoTimer = setTimeout(() => document.body.classList.remove("ps-logo-visible"), reduced.matches ? 1800 : 3300);
      exitTimer = setTimeout(depart, reduced.matches ? 4500 : 10000);
    }
  };
  window.addEventListener("keydown", (event) => { if (event.key === "Escape" && active) depart(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden && active) finish(); });
  reduced.addEventListener("change", () => { if (active) finish(); });
})();
