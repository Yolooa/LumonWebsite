(() => {
  "use strict";
  const stage = () => document.querySelector("#gameStage");
  const setMessage = (text, win = false) => {
    const target = document.querySelector("#gameMessage");
    target.textContent = text;
    target.classList.toggle("win", win);
  };
  const cardButton = (card, extra = "") => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `playing-card ${extra}`.trim();
    button.dataset.card = String(card.id);
    button.setAttribute("aria-label", card.label);
    const top = document.createElement("span"); top.className = "card-corner"; top.textContent = card.label;
    const center = document.createElement("strong"); center.className = "card-center"; center.textContent = card.symbol;
    const bottom = document.createElement("span"); bottom.className = "card-corner card-corner-bottom"; bottom.textContent = card.label;
    button.append(top, center, bottom);
    return button;
  };

  function createUno() {
    const root = document.createElement("section"); root.className = "uno-table";
    const top = document.createElement("div"); top.className = "uno-opponent";
    const opponentName = document.createElement("strong"); opponentName.textContent = "LUMON BOT";
    const opponentCount = document.createElement("span"); top.append(opponentName, opponentCount);
    const arena = document.createElement("div"); arena.className = "uno-arena";
    const deckButton = document.createElement("button"); deckButton.type = "button"; deckButton.className = "uno-deck"; deckButton.setAttribute("aria-label", "从牌堆摸一张牌"); deckButton.innerHTML = "<span>UNO</span><small>摸一张</small>";
    const discard = document.createElement("div"); discard.className = "uno-discard";
    const direction = document.createElement("div"); direction.className = "uno-direction"; direction.setAttribute("aria-hidden", "true"); direction.textContent = "↻";
    arena.append(deckButton, direction, discard);
    const handHeading = document.createElement("div"); handHeading.className = "uno-hand-heading";
    const handLabel = document.createElement("span"); const unoButton = document.createElement("button"); unoButton.type = "button"; unoButton.className = "uno-call"; unoButton.textContent = "UNO!"; unoButton.hidden = true;
    handHeading.append(handLabel, unoButton);
    const hand = document.createElement("div"); hand.className = "uno-hand";
    const controls = document.createElement("div"); controls.className = "uno-color-choice"; controls.hidden = true;
    const hint = document.createElement("p"); hint.className = "uno-hint";
    root.append(top, arena, handHeading, hand, controls, hint); stage().append(root);
    const colors = ["red", "yellow", "green", "blue"];
    const colorNames = { red: "红", yellow: "黄", green: "绿", blue: "蓝" };
    const colorSymbols = { red: "●", yellow: "◆", green: "●", blue: "◆" };
    const actionNames = { skip: "跳过", reverse: "反转", draw2: "+2", wild: "变色", wild4: "+4" };
    let deck; let player; let cpu; let pile; let currentColor; let turn; let drawnId; let ended; let pendingWild; let botTimer;
    function makeDeck() {
      const cards = []; let id = 0;
      for (const color of colors) {
        cards.push({ id: id++, color, value: 0 });
        for (let value = 1; value <= 9; value++) for (let copy = 0; copy < 2; copy++) cards.push({ id: id++, color, value });
        for (const value of ["skip", "reverse", "draw2"]) for (let copy = 0; copy < 2; copy++) cards.push({ id: id++, color, value });
      }
      for (let copy = 0; copy < 4; copy++) { cards.push({ id: id++, color: null, value: "wild" }, { id: id++, color: null, value: "wild4" }); }
      for (let i = cards.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cards[i], cards[j]] = [cards[j], cards[i]]; }
      return cards;
    }
    function label(card) { return card.color ? `${colorNames[card.color]}${typeof card.value === "number" ? card.value : actionNames[card.value]}` : actionNames[card.value]; }
    function symbol(card) { return card.color ? (typeof card.value === "number" ? String(card.value) : actionNames[card.value]) : card.value === "wild4" ? "+4" : "✦"; }
    function canPlay(card) { const topCard = pile[pile.length - 1]; return card.value === "wild" || card.value === "wild4" || card.color === currentColor || card.value === topCard.value; }
    function draw(target, count = 1) {
      for (let i = 0; i < count; i++) {
        if (!deck.length) {
          const active = pile.pop(); deck = pile.splice(0).sort(() => Math.random() - .5); pile.push(active);
        }
        if (deck.length) target.push(deck.pop());
      }
    }
    function finish(winner) {
      ended = true; clearTimeout(botTimer);
      const won = winner === "你";
      document.querySelector("#gameScore").textContent = won ? "胜利" : "再来一局";
      setMessage(won ? "漂亮！最后一张牌打出去了。" : "电脑先走完了手牌，再来一局？", won);
    }
    function startTurn() {
      if (ended) return;
      if (turn === "cpu") { hint.textContent = "Lumon Bot 正在思考…"; botTimer = setTimeout(cpuMove, 850 + Math.random() * 550); }
      render();
    }
    function resolveEffect(card, actor) {
      if (card.value === "draw2") { const target = actor === "player" ? cpu : player; draw(target, 2); turn = actor === "player" ? "cpu" : "player"; }
      else if (card.value === "wild4") { const target = actor === "player" ? cpu : player; draw(target, 4); turn = actor === "player" ? "cpu" : "player"; }
      else if (card.value === "skip" || card.value === "reverse") turn = actor;
      else turn = actor === "player" ? "cpu" : "player";
      if (actor === "player" && player.length === 0) return finish("你");
      if (actor === "cpu" && cpu.length === 0) return finish("电脑");
      startTurn();
    }
    function playCard(card, actor, chosenColor = null) {
      const handCards = actor === "player" ? player : cpu;
      const index = handCards.findIndex((item) => item.id === card.id);
      if (index < 0) return;
      if (actor === "player") { drawnId = null; endTurnButton.hidden = true; }
      const [played] = handCards.splice(index, 1); pile.push(played);
      if (played.color) currentColor = played.color;
      else if (chosenColor) currentColor = chosenColor;
      if (actor === "player" && handCards.length === 1) setMessage("UNO！手里还剩最后一张牌。", true);
      resolveEffect(played, actor);
    }
    function chooseColor(card, actor) {
      if (actor === "cpu") {
        const counts = Object.fromEntries(colors.map((color) => [color, cpu.filter((item) => item.color === color).length]));
        playCard(card, actor, [...colors].sort((a, b) => counts[b] - counts[a])[0]); return;
      }
      pendingWild = card; controls.replaceChildren(); controls.hidden = false;
      for (const color of colors) {
        const button = document.createElement("button"); button.type = "button"; button.className = `uno-color ${color}`; button.textContent = colorNames[color];
        button.addEventListener("click", () => { controls.hidden = true; const chosen = pendingWild; pendingWild = null; playCard(chosen, "player", color); });
        controls.append(button);
      }
      hint.textContent = "为万能牌选择一种颜色。";
    }
    function playHuman(card) {
      if (ended || turn !== "player" || pendingWild || !canPlay(card)) return;
      playCard(card, "player");
    }
    function humanDraw() {
      if (ended || turn !== "player" || pendingWild) return;
      const before = player.length; draw(player); drawnId = player.at(-1)?.id;
      if (player.length === before) { setMessage("牌堆已空，没有可摸的牌。"); return; }
      hint.textContent = "摸到一张牌：可以打出高亮牌，或点击「结束回合」。";
      endTurnButton.hidden = false; render();
    }
    const endTurnButton = document.createElement("button"); endTurnButton.type = "button"; endTurnButton.className = "uno-end-turn"; endTurnButton.textContent = "结束回合"; endTurnButton.hidden = true;
    handHeading.append(endTurnButton);
    endTurnButton.addEventListener("click", () => { if (turn !== "player" || !drawnId) return; drawnId = null; endTurnButton.hidden = true; turn = "cpu"; startTurn(); });
    unoButton.addEventListener("click", () => setMessage(player.length === 1 ? "UNO！电脑可要小心了。" : "剩下一张牌时记得喊 UNO！"));
    deckButton.addEventListener("click", humanDraw);
    function render() {
      opponentCount.textContent = `${cpu.length} 张手牌`;
      handLabel.textContent = `你的手牌 · ${player.length} 张`;
      document.querySelector("#gameScore").textContent = `${player.length} 张`;
      document.querySelector("#gameBest").textContent = ended ? "已结束" : turn === "player" ? "你的回合" : "电脑回合";
      discard.replaceChildren();
      const topCard = pile[pile.length - 1];
      const shown = cardButton({ ...topCard, label: label(topCard), symbol: symbol(topCard) }, `uno-card ${topCard.color || currentColor} played-card`);
      shown.disabled = true; discard.append(shown);
      hand.replaceChildren();
      player.forEach((card) => {
        const button = cardButton({ ...card, label: label(card), symbol: symbol(card) }, `uno-card ${card.color || "wild"}`);
        const legal = turn === "player" && canPlay(card) && (!drawnId || card.id === drawnId);
        button.disabled = !legal || Boolean(pendingWild);
        button.classList.toggle("is-playable", legal); button.classList.toggle("just-drawn", card.id === drawnId);
        button.addEventListener("click", () => card.color ? playHuman(card) : chooseColor(card, "player"));
        hand.append(button);
      });
      deckButton.disabled = ended || turn !== "player" || Boolean(drawnId) || Boolean(pendingWild);
      unoButton.hidden = player.length !== 1 || ended;
      if (turn === "cpu") hint.textContent = "轮到电脑 · 留意当前颜色和牌面。";
      else if (!drawnId && !pendingWild && !ended) hint.textContent = "打出匹配颜色或数字的牌；万能牌可随时打出。";
    }
    function cpuMove() {
      if (ended || turn !== "cpu") return;
      const legal = cpu.filter(canPlay).sort((a, b) => (a.color ? 0 : 1) - (b.color ? 0 : 1));
      if (!legal.length) { const before = cpu.length; draw(cpu); const newCard = cpu.length > before ? cpu.at(-1) : null; if (newCard && canPlay(newCard)) playCard(newCard, "cpu"); else { turn = "player"; startTurn(); } return; }
      const card = legal[0];
      if (card.color) playCard(card, "cpu"); else chooseColor(card, "cpu");
    }
    function restart() {
      clearTimeout(botTimer); deck = makeDeck(); player = []; cpu = []; pile = []; turn = "player"; drawnId = null; ended = false; pendingWild = null; controls.hidden = true; endTurnButton.hidden = true;
      for (let i = 0; i < 7; i++) { player.push(deck.pop()); cpu.push(deck.pop()); }
      let first = deck.pop(); while (first.color === null || typeof first.value !== "number") { deck.unshift(first); first = deck.pop(); }
      pile.push(first); currentColor = first.color; document.querySelector("#gameScore").textContent = "0"; setMessage("先出牌，看看 Bot 能不能跟上。 "); render();
    }
    restart();
    return { restart, focus: () => hand.querySelector("button.is-playable")?.focus({ preventScroll: true }), key(event) { if (/^[1-9]$/.test(event.key)) { const card = player[Number(event.key) - 1]; if (card) card.color ? playHuman(card) : chooseColor(card, "player"); } if (event.key.toLowerCase() === "d") humanDraw(); }, destroy() { clearTimeout(botTimer); } };
  }

  function createLandlord() {
    const root = document.createElement("section"); root.className = "landlord-table";
    const opponents = document.createElement("div"); opponents.className = "landlord-opponents";
    const seats = ["LEFT BOT", "RIGHT BOT"].map((name) => { const el = document.createElement("div"); el.className = "landlord-seat"; const title = document.createElement("strong"); title.textContent = name; const count = document.createElement("span"); el.append(title, count); opponents.append(el); return { el, count }; });
    const trick = document.createElement("div"); trick.className = "landlord-trick";
    const trickNote = document.createElement("div"); trickNote.className = "trick-note"; trick.append(trickNote);
    const handHeader = document.createElement("div"); handHeader.className = "landlord-hand-header";
    const handLabel = document.createElement("span"); handLabel.textContent = "你的手牌"; const selectionLabel = document.createElement("small"); handHeader.append(handLabel, selectionLabel);
    const hand = document.createElement("div"); hand.className = "landlord-hand";
    const actions = document.createElement("div"); actions.className = "landlord-actions";
    const actionNames = ["不出", "出牌", "不叫", "1 分", "2 分", "3 分", "重新发牌"];
    const actionButtons = actionNames.map((text) => { const button = document.createElement("button"); button.type = "button"; button.className = "landlord-action"; button.textContent = text; actions.append(button); return button; });
    const [passButton, playButton, bidPass, bidOne, bidTwo, bidThree, dealButton] = actionButtons;
    root.append(opponents, trick, handHeader, hand, actions); stage().append(root);
    const suits = ["♣", "♦", "♥", "♠"];
    const suitClass = { "♣": "clubs", "♦": "diamonds", "♥": "hearts", "♠": "spades" };
    const rankLabels = { 11: "J", 12: "Q", 13: "K", 14: "A", 15: "2", 16: "小王", 17: "大王" };
    const players = [[], [], []]; const names = ["你", "左侧电脑", "右侧电脑"];
    const selected = new Set();
    let landlord = -1; let turn = 0; let auctionTurn = 0; let auctionMax = 0; let auctionBest = -1; let auctionDone = 0;
    let topPlay = null; let topPlayer = -1; let passes = 0; let ended = false; let timer; let deck = [];
    let cardId = 0;
    const rankName = (rank) => rankLabels[rank] || String(rank);
    const cardName = (card) => card.rank >= 16 ? rankName(card.rank) : `${rankName(card.rank)}${card.suit}`;
    const buildDeck = () => {
      const cards = [];
      for (let rank = 3; rank <= 15; rank++) for (const suit of suits) cards.push({ id: cardId++, rank, suit });
      cards.push({ id: cardId++, rank: 16, suit: "JOKER" }, { id: cardId++, rank: 17, suit: "JOKER" });
      for (let i = cards.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cards[i], cards[j]] = [cards[j], cards[i]]; }
      return cards;
    };
    function countsOf(cards) { const counts = new Map(); cards.forEach((card) => counts.set(card.rank, (counts.get(card.rank) || 0) + 1)); return counts; }
    function classify(cards) {
      if (!cards.length) return null;
      const sorted = [...cards].sort((a, b) => a.rank - b.rank); const counts = countsOf(sorted); const values = [...counts.values()].sort((a, b) => b - a); const ranks = [...counts.keys()].sort((a, b) => a - b); const len = sorted.length;
      let type = ""; let rank = Math.max(...ranks);
      if (len === 1) type = "single";
      else if (len === 2 && ranks[0] === 16 && ranks[1] === 17) type = "rocket";
      else if (len === 2 && values[0] === 2) type = "pair";
      else if (len === 3 && values[0] === 3) type = "triple";
      else if (len === 4 && values[0] === 4) type = "bomb";
      else if (len === 4 && values[0] === 3) { type = "tripleSingle"; rank = ranks.find((r) => counts.get(r) === 3); }
      else if (len === 5 && values[0] === 3 && values[1] === 2) { type = "triplePair"; rank = ranks.find((r) => counts.get(r) === 3); }
      else if (len === 6 && values[0] === 4) { type = "fourTwo"; rank = ranks.find((r) => counts.get(r) === 4); }
      else if (len >= 5 && ranks.length === len && ranks.at(-1) <= 14 && ranks.every((r, i) => i === 0 || r === ranks[i - 1] + 1)) type = "straight";
      else if (len >= 6 && len % 2 === 0 && ranks.length * 2 === len && ranks.at(-1) <= 14 && values.every((v) => v === 2) && ranks.every((r, i) => i === 0 || r === ranks[i - 1] + 1)) type = "pairs";
      if (!type) return null;
      return { type, rank, size: len, cards: sorted };
    }
    const typeLabel = { single: "单张", pair: "对子", triple: "三张", tripleSingle: "三带一", triplePair: "三带对", straight: "顺子", pairs: "连对", fourTwo: "四带二", bomb: "炸弹", rocket: "王炸" };
    function beats(candidate, previous) {
      if (candidate.type === "rocket") return previous.type !== "rocket";
      if (previous.type === "rocket") return false;
      if (candidate.type === "bomb") return previous.type !== "bomb" || candidate.rank > previous.rank;
      if (previous.type === "bomb") return false;
      return candidate.type === previous.type && candidate.size === previous.size && candidate.rank > previous.rank;
    }
    function allCombos(cards, maxSize = 6) {
      const output = [];
      for (let size = 1; size <= Math.min(maxSize, cards.length); size++) {
        const picked = [];
        function visit(start) {
          if (picked.length === size) { const combo = classify(picked); if (combo) output.push(combo); return; }
          for (let i = start; i <= cards.length - (size - picked.length); i++) { picked.push(cards[i]); visit(i + 1); picked.pop(); }
        }
        visit(0);
      }
      return output.sort((a, b) => a.size - b.size || a.rank - b.rank);
    }
    function renderTrick() {
      trick.replaceChildren();
      const title = document.createElement("div"); title.className = "trick-note";
      if (!topPlay) title.textContent = ended ? "本局结束" : "新的一轮 · 由地主先出";
      else title.textContent = `${names[topPlayer]} 出了 ${typeLabel[topPlay.type]} · ${topPlay.cards.map(cardName).join("  ")}`;
      trick.append(title);
      if (topPlay) { const row = document.createElement("div"); row.className = "trick-cards"; topPlay.cards.forEach((card) => row.append(cardButton({ ...card, label: cardName(card), symbol: card.rank >= 16 ? rankName(card.rank) : rankName(card.rank) }, `landlord-card ${suitClass[card.suit] || "joker"}`))); trick.append(row); }
      selectionLabel.textContent = `${players[0].length} 张 · 已选 ${selected.size} 张`;
    }
    function renderHand() {
      hand.replaceChildren();
      players[0].forEach((card) => {
        const button = cardButton({ ...card, label: cardName(card), symbol: rankName(card.rank) }, `landlord-card ${suitClass[card.suit] || "joker"}`);
        button.classList.toggle("selected", selected.has(card.id));
        button.addEventListener("click", () => { if (ended || turn !== 0 || landlord < 0) return; if (selected.has(card.id)) selected.delete(card.id); else selected.add(card.id); renderHand(); renderTrick(); });
        hand.append(button);
      });
      seats.forEach((seat, index) => { seat.count.textContent = `${players[index + 1].length} 张手牌${landlord === index + 1 ? " · 地主" : ""}`; seat.el.classList.toggle("landlord", landlord === index + 1); seat.el.classList.toggle("active", turn === index + 1 && !ended); });
      const bidding = landlord < 0 && !ended;
      [bidPass, bidOne, bidTwo, bidThree].forEach((button) => { button.hidden = !bidding || auctionTurn !== 0; });
      passButton.hidden = bidding || ended || turn !== 0 || !topPlay || topPlayer === 0;
      playButton.hidden = bidding || ended || turn !== 0;
      dealButton.hidden = !ended;
      playButton.disabled = selected.size === 0;
      passButton.disabled = topPlayer === 0;
      document.querySelector("#gameScore").textContent = `${players[0].length} 张`;
      document.querySelector("#gameBest").textContent = ended ? "本局结束" : landlord < 0 ? (auctionTurn === 0 ? `最高 ${auctionMax} 分` : `${names[auctionTurn]}叫分中`) : `${names[landlord]}是地主`;
    }
    function render() { renderTrick(); renderHand(); }
    function finish(winner) {
      ended = true; clearTimeout(timer); selected.clear();
      const humanWon = winner === 0;
      document.querySelector("#gameScore").textContent = humanWon ? "胜利" : "失败";
      setMessage(humanWon ? "恭喜！你先出完了手牌。" : `${names[winner]}先出完了手牌。`, humanWon);
      render();
    }
    function nextPlayer() { turn = (turn + 1) % 3; if (turn !== 0) timer = setTimeout(cpuTurn, 760); render(); }
    function playCards(index, cards, combo) {
      const ids = new Set(cards.map((card) => card.id));
      players[index] = players[index].filter((card) => !ids.has(card.id));
      topPlay = combo; topPlayer = index; passes = 0; selected.clear();
      if (!players[index].length) return finish(index);
      setMessage(`${names[index]}出了${typeLabel[combo.type]}。`);
      nextPlayer();
    }
    function pass(index) {
      if (index === topPlayer) return;
      passes++; selected.clear();
      if (passes >= 2) { turn = topPlayer; topPlay = null; topPlayer = -1; passes = 0; setMessage(`${names[turn]}收回牌权，重新出牌。`); if (turn !== 0) timer = setTimeout(cpuTurn, 760); }
      else { turn = (index + 1) % 3; setMessage(`${names[index]}不出。`); if (turn !== 0) timer = setTimeout(cpuTurn, 760); }
      render();
    }
    function humanPlay() {
      if (turn !== 0 || landlord < 0 || ended) return;
      const chosen = players[0].filter((card) => selected.has(card.id)); const combo = classify(chosen);
      if (!combo) { setMessage("这组牌暂不符合牌型，请调整选择。 "); return; }
      if (topPlay && topPlayer !== 0 && !beats(combo, topPlay)) { setMessage("这组牌压不过上一手，试试更大的牌或选择不出。"); return; }
      playCards(0, chosen, combo);
    }
    function cpuTurn() {
      if (ended || turn === 0) return;
      const handCards = players[turn];
      let options;
      if (topPlay && topPlayer !== turn) options = allCombos(handCards).filter((combo) => beats(combo, topPlay));
      else options = allCombos(handCards).filter((combo) => combo.type === "single");
      if (!options.length) { pass(turn); return; }
      const combo = options[0];
      playCards(turn, combo.cards, combo);
    }
    function power(cards) { return cards.reduce((sum, card) => sum + (card.rank >= 16 ? 5 : card.rank === 15 ? 2.4 : card.rank >= 14 ? 1.5 : 0), 0); }
    function bid(value) {
      if (auctionTurn !== 0 || landlord >= 0 || ended) return;
      recordBid(0, value);
    }
    function recordBid(index, value) {
      auctionBest = value > auctionMax ? index : auctionBest; auctionMax = Math.max(auctionMax, value); auctionDone++; auctionTurn = (index + 1) % 3;
      if (value === 3) { landlord = index; beginPlay(); }
      else if (auctionDone >= 3) {
        landlord = auctionMax ? auctionBest : [0, 1, 2].sort((a, b) => power(players[b]) - power(players[a]))[0];
        beginPlay();
      } else if (auctionTurn !== 0) timer = setTimeout(cpuBid, 650);
      render();
    }
    function cpuBid() {
      if (landlord >= 0 || auctionTurn === 0 || ended) return;
      const handCards = players[auctionTurn]; const strength = power(handCards);
      const value = strength > 18 ? 3 : strength > 13 ? 2 : strength > 8 && Math.random() > .25 ? 1 : 0;
      recordBid(auctionTurn, value);
    }
    function beginPlay() {
      [0, 1, 2].forEach((index) => players[index].sort((a, b) => a.rank - b.rank || suits.indexOf(a.suit) - suits.indexOf(b.suit)));
      players[landlord].push(...deck); players[landlord].sort((a, b) => a.rank - b.rank || suits.indexOf(a.suit) - suits.indexOf(b.suit));
      turn = landlord; topPlay = null; topPlayer = -1; passes = 0; selected.clear();
      document.querySelector("#gameScore").textContent = "叫分";
      setMessage(`${names[landlord]}成为地主，获得底牌。${landlord === 0 ? "轮到你出牌。" : "电脑先出牌。"}`, true);
      render(); if (turn !== 0) timer = setTimeout(cpuTurn, 850);
    }
    function reset() {
      clearTimeout(timer); cardId = 0; deck = buildDeck(); players.forEach((cards) => cards.splice(0));
      for (let i = 0; i < 17; i++) for (let player = 0; player < 3; player++) players[player].push(deck.pop());
      landlord = -1; turn = 0; auctionTurn = 0; auctionMax = 0; auctionBest = -1; auctionDone = 0; topPlay = null; topPlayer = -1; passes = 0; ended = false; selected.clear();
      document.querySelector("#gameScore").textContent = "叫分"; setMessage("选择叫分；最高叫分者做地主，先出完手牌获胜。"); render();
    }
    bidPass.addEventListener("click", () => bid(0)); bidOne.addEventListener("click", () => bid(1)); bidTwo.addEventListener("click", () => bid(2)); bidThree.addEventListener("click", () => bid(3));
    passButton.addEventListener("click", () => pass(0)); playButton.addEventListener("click", humanPlay); dealButton.addEventListener("click", reset);
    reset();
    return { restart: reset, focus: () => hand.querySelector("button")?.focus({ preventScroll: true }), key(event) {
      if (event.key.toLowerCase() === "p") landlord < 0 ? bid(0) : pass(0);
      if (event.key === "Enter" && !event.target.closest?.("button")) humanPlay();
      if (event.key.toLowerCase() === "a") bid(1);
      if (event.key.toLowerCase() === "s") bid(2);
      if (event.key.toLowerCase() === "d") bid(3);
    }, destroy() { clearTimeout(timer); } };
  }

  function mlbLogoMarkup(extraClass = "") {
    return `<img class="mlb-logo ${extraClass}" src="assets/mlb-1.svg" alt="MLB 官方击球手标志" draggable="false">`;
  }

  function createMlb() {
    const root = document.createElement("section"); root.className = "mlb-game";
    root.innerHTML = `<div class="mlb-scoreboard"><div class="mlb-club"><div class="mlb-brand-lockup">${mlbLogoMarkup()}<span class="mlb-letters" aria-label="MLB"><i>M</i><i>L</i><i>B</i></span></div><span class="mlb-club-copy"><strong>HOME RUN DERBY</strong><small>TONIGHT / LUMON PARK</small></span></div><div class="mlb-stat"><small>球数</small><strong id="mlbPitchCount">00 / 10</strong></div><div class="mlb-stat"><small>本垒打</small><strong id="mlbHomeRuns">0</strong></div><div class="mlb-stat"><small>最远距离</small><strong id="mlbLongest">—</strong></div></div><div class="mlb-venue"><svg class="mlb-field" viewBox="0 0 1000 440" role="img" aria-label="夜间棒球场与击球区"><defs><linearGradient id="mlbSky" x2="0" y2="1"><stop stop-color="#101e30"/><stop offset="1" stop-color="#304b60"/></linearGradient><linearGradient id="mlbGrass" x2="0" y2="1"><stop stop-color="#387d65"/><stop offset="1" stop-color="#193b35"/></linearGradient><radialGradient id="mlbDirt"><stop stop-color="#d3a171"/><stop offset="1" stop-color="#a76b49"/></radialGradient><linearGradient id="mlbJersey" x2="0" y2="1"><stop stop-color="#f8faf7"/><stop offset="1" stop-color="#bdcbd1"/></linearGradient><filter id="mlbGlow"><feGaussianBlur stdDeviation="10"/></filter></defs><rect width="1000" height="440" fill="url(#mlbSky)"/><g class="mlb-lights"><path d="M130 45v110m740-110v110" stroke="#d8f3ff" stroke-opacity=".1" stroke-width="34" filter="url(#mlbGlow)"/><path d="M130 45v110m740-110v110" stroke="#f4fbff" stroke-opacity=".66" stroke-width="3"/><path d="M105 51h50m690 0h50M105 62h50m690 0h50" stroke="#d9f1ff" stroke-opacity=".7" stroke-width="4"/></g><path d="M43 191Q500 46 957 191L957 252Q500 118 43 252Z" fill="#243744"/><path d="M45 211Q500 75 955 211" fill="none" stroke="#94acb6" stroke-opacity=".45" stroke-width="3"/><g id="mlbCrowd"></g><path d="M57 219Q500 91 943 219L943 255Q500 140 57 255Z" fill="#b66b43"/><path d="M57 219Q500 91 943 219" fill="none" stroke="#ffcf8a" stroke-width="4"/><path d="M500 414 123 238Q500 112 877 238Z" fill="url(#mlbGrass)"/><path d="M500 414 223 282Q500 178 777 282Z" fill="#a86f4f"/><path d="M500 393 315 281 500 203 685 281Z" fill="url(#mlbDirt)"/><path d="M500 404 220 250m280 154 280-154" stroke="#fff5de" stroke-width="2" stroke-opacity=".72"/><path d="m500 205 38 76-38 76-38-76Z" fill="none" stroke="#fff5de" stroke-width="2"/><g fill="#fff8e9" stroke="#a9b4b4" stroke-width="1"><rect x="491" y="196" width="18" height="14" rx="2"/><rect x="529" y="272" width="15" height="13" rx="2" transform="rotate(45 536 278)"/><rect x="493" y="348" width="14" height="13" rx="2"/><rect x="456" y="272" width="15" height="13" rx="2" transform="rotate(45 463 278)"/><path d="M489 397h22l-4 12-7 5-7-5Z"/></g><ellipse cx="500" cy="258" rx="39" ry="12" fill="#bd8960"/><g class="mlb-pitcher"><path d="M490 233q10-13 20 0l-1 20h-18Z" fill="#e7edf0"/><circle cx="500" cy="222" r="9" fill="#c89d79"/><path d="m488 254-12 20m24-20 10 19m-19-8-18-5m22 5 15-12" stroke="#e9eef0" stroke-width="7" stroke-linecap="round"/><path d="m477 274-8 12m41-13 8 11" stroke="#1d2731" stroke-width="8" stroke-linecap="round"/></g><g id="mlbBatter"><path d="m349 364 3 27m35-26-6 27" stroke="#252e39" stroke-width="14" stroke-linecap="round"/><path d="m348 388-11 3m45-1 12 3" stroke="#e8ecee" stroke-width="7" stroke-linecap="round"/><path d="m346 332q21-17 45 1l-4 31q-23 12-44-1Z" fill="url(#mlbJersey)" stroke="#fff" stroke-width="2"/><path d="m347 340-15 18m58-17 13 7" stroke="#dce5e8" stroke-width="10" stroke-linecap="round"/><circle cx="368" cy="320" r="13" fill="#be8d70"/><path d="M354 317q1-17 16-17 15 1 14 15l-6-4-22 3Z" fill="#172c42"/><path d="m394 337 62-65" stroke="#c59455" stroke-width="9" stroke-linecap="round"/><path d="m450 280 13-14" stroke="#eee0c9" stroke-width="10" stroke-linecap="round"/><circle cx="384" cy="350" r="4" fill="#d4aa31"/><g class="mlb-bat"><path d="m397 336 65-72" stroke="#d7b074" stroke-width="9" stroke-linecap="round"/><path d="m456 270 11-14" stroke="#f5ead5" stroke-width="10" stroke-linecap="round"/></g></g><g class="mlb-shadow"><ellipse cx="370" cy="400" rx="46" ry="8" fill="#08120f" fill-opacity=".45"/><ellipse cx="500" cy="274" rx="26" ry="5" fill="#08120f" fill-opacity=".3"/></g><circle id="mlbBall" cx="500" cy="256" r="5" fill="#fff" stroke="#da4747" stroke-width="2" visibility="hidden"/><path id="mlbBallTrail" d="" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="3" stroke-linecap="round"/></svg><div class="mlb-count-call" id="mlbCall">等待首球</div><div class="mlb-pitch-label" id="mlbPitchLabel">投手准备中</div><div class="mlb-distance" id="mlbDistance"></div></div><div class="mlb-controls"><div class="mlb-timing"><div class="mlb-meter-label"><span>击球时机</span><span id="mlbTimingText">READY</span></div><div class="mlb-meter"><span class="mlb-perfect-zone"></span><i id="mlbNeedle"></i></div><div class="mlb-meter-legend"><span>过早</span><span>甜蜜点</span><span>过晚</span></div></div><button id="mlbStart" class="mlb-start">开始比赛 <span>↗</span></button><button id="mlbSwing" class="mlb-swing" disabled><span class="swing-icon">↗</span><span><strong>挥棒</strong><small>按空格击球</small></span><kbd>SPACE</kbd></button></div><div class="mlb-result" id="mlbResult" aria-live="polite"></div>`;
    stage().append(root);
    const svg = root.querySelector(".mlb-field"); const ball = root.querySelector("#mlbBall"); const trail = root.querySelector("#mlbBallTrail"); const batter = root.querySelector("#mlbBatter");
    const count = root.querySelector("#mlbPitchCount"); const homeRuns = root.querySelector("#mlbHomeRuns"); const longest = root.querySelector("#mlbLongest"); const call = root.querySelector("#mlbCall"); const pitchLabel = root.querySelector("#mlbPitchLabel"); const distance = root.querySelector("#mlbDistance"); const timingText = root.querySelector("#mlbTimingText"); const needle = root.querySelector("#mlbNeedle"); const result = root.querySelector("#mlbResult"); const startButton = root.querySelector("#mlbStart"); const swingButton = root.querySelector("#mlbSwing");
    const crowd = root.querySelector("#mlbCrowd"); const svgNS = "http://www.w3.org/2000/svg";
    for (let i = 0; i < 130; i++) { const dot = document.createElementNS(svgNS, "circle"); const angle = i * 2.399; dot.setAttribute("cx", String(48 + (i * 73 % 904))); dot.setAttribute("cy", String(132 + Math.sin(angle) * 36 + (i * 19 % 30))); dot.setAttribute("r", String(1 + i % 3 * .35)); dot.setAttribute("fill", ["#f3c57e", "#cce7f0", "#f0edf0", "#e98265"][i % 4]); dot.setAttribute("fill-opacity", String(.3 + (i % 5) * .1)); crowd.append(dot); }
    let pitch = 0; let scoreValue = 0; let homers = 0; let farthest = 0; let active = false; let swung = false; let pitchStart = 0; let targetAt = 0; let flight = 0; let raf = 0; let timer = 0; let aimX = 500; let aimY = 342; let pitchName = "";
    const pitches = ["四缝线速球", "滑球", "曲球", "伸卡球"];
    function stopMotion() { cancelAnimationFrame(raf); clearTimeout(timer); }
    function updateBoard() { count.textContent = `${String(Math.min(pitch, 10)).padStart(2, "0")} / 10`; homeRuns.textContent = String(homers); longest.textContent = farthest ? `${farthest} ft` : "—"; document.querySelector("#gameScore").textContent = scoreValue.toLocaleString(); }
    function report(text, mode = "") { call.textContent = text; call.className = `mlb-count-call ${mode}`.trim(); }
    function nextPitch() {
      if (!active) return;
      if (pitch >= 10) { finish(); return; }
      pitch++; swung = false; pitchStart = performance.now(); flight = 1440 + Math.random() * 510; targetAt = pitchStart + flight * .86;
      pitchName = pitches[Math.floor(Math.random() * pitches.length)]; aimX = 482 + Math.random() * 36; aimY = 335 + Math.random() * 13;
      count.textContent = `${String(pitch).padStart(2, "0")} / 10`; pitchLabel.textContent = `${pitchName} · ${Math.round(flight / 1000 * 96)} mph`; report("来球！盯住投手", "live"); timingText.textContent = "TRACKING"; swingButton.disabled = false;
      const update = (now) => {
        if (!active || swung) return;
        const t = Math.max(0, Math.min(1, (now - pitchStart) / flight));
        const ease = t * t * (3 - 2 * t); const curve = Math.sin(t * Math.PI) * (aimX - 500) * .5;
        ball.setAttribute("visibility", "visible"); ball.setAttribute("cx", String(500 + (aimX - 500) * ease + curve)); ball.setAttribute("cy", String(230 + (aimY - 230) * ease)); ball.setAttribute("r", String(3.2 + t * 5));
        trail.setAttribute("d", `M${500 + (aimX - 500) * Math.max(0, ease - .09)} ${230 + (aimY - 230) * Math.max(0, ease - .09)} Q${500 + curve} ${230 + (aimY - 230) * ease - 9} ${500 + (aimX - 500) * ease + curve} ${230 + (aimY - 230) * ease}`);
        needle.style.left = `${Math.min(100, t * 100)}%`;
        if (t > .73) timingText.textContent = t < .84 ? "NOW" : "CONTACT";
        if (t >= 1) { timer = setTimeout(() => { if (!swung && active) outcome("strike"); }, 230); return; }
        raf = requestAnimationFrame(update);
      };
      raf = requestAnimationFrame(update);
    }
    function animateFlight(isHomeRun, feet) {
      const ballX = Number(ball.getAttribute("cx")) || aimX; const ballY = Number(ball.getAttribute("cy")) || aimY;
      const endX = isHomeRun ? 170 + Math.random() * 660 : 400 + Math.random() * 200; const endY = isHomeRun ? 70 + Math.random() * 125 : 220 + Math.random() * 50;
      ball.setAttribute("visibility", "visible"); ball.animate([{ transform: `translate(${ballX - 500}px,${ballY - 220}px) scale(1)` }, { transform: `translate(${endX - 500}px,${endY - 220}px) scale(.58)` }], { duration: isHomeRun ? 1000 : 620, easing: "cubic-bezier(.16,1,.3,1)", fill: "forwards" });
      if (isHomeRun) { root.classList.add("home-run"); setTimeout(() => root.classList.remove("home-run"), 820); }
      if (feet) distance.textContent = `${feet} FT`;
    }
    function outcome(kind, delta = 999) {
      if (swung || !active) return;
      swung = true; clearTimeout(timer); cancelAnimationFrame(raf); swingButton.disabled = true;
      batter.classList.remove("swinging"); void batter.getBoundingClientRect(); batter.classList.add("swinging");
      let points = 0; let label = "挥空"; let mode = "miss"; let feet = 0;
      if (kind === "strike") { label = "好球 · 再盯紧一点"; mode = "miss"; timingText.textContent = "CALLED STRIKE"; }
      else if (Math.abs(delta) > 165) { label = delta < 0 ? "出棒太早 · 挥空" : "出棒太晚 · 挥空"; mode = "miss"; timingText.textContent = delta < 0 ? "TOO EARLY" : "TOO LATE"; }
      else if (Math.abs(delta) > 112) { label = "界外球！"; mode = "foul"; points = 8; timingText.textContent = "FOUL"; animateFlight(false, 0); }
      else if (Math.abs(delta) <= 31) {
        const homeRun = Math.random() < .78; feet = homeRun ? 405 + Math.round(Math.random() * 78) : 335 + Math.round(Math.random() * 49);
        if (homeRun) { homers++; points = 125 + Math.round((feet - 405) * 1.5); label = `本垒打！完美击球 · ${feet} 英尺`; mode = "homer"; }
        else { points = 80; label = `长打！击球飞行 ${feet} 英尺`; mode = "hit"; }
        timingText.textContent = "PERFECT"; animateFlight(homeRun, feet);
      } else {
        const homeRun = Math.abs(delta) < 75 && Math.random() < .22; feet = homeRun ? 397 + Math.round(Math.random() * 54) : Math.abs(delta) < 75 ? 280 + Math.round(Math.random() * 80) : 170 + Math.round(Math.random() * 95);
        if (homeRun) { homers++; points = 115 + Math.round((feet - 397) * 1.3); label = `拉回本垒打！${feet} 英尺`; mode = "homer"; }
        else if (Math.abs(delta) < 75) { points = 53; label = `扎实安打 · ${feet} 英尺`; mode = "hit"; }
        else { points = 23; label = `弱击安打 · ${feet} 英尺`; mode = "weak"; }
        timingText.textContent = delta < 0 ? "A LITTLE EARLY" : "A LITTLE LATE"; animateFlight(homeRun, feet);
      }
      scoreValue += points; if (feet) farthest = Math.max(farthest, feet); result.textContent = points ? `+${points}` : ""; result.className = `mlb-result ${mode}`; report(label, mode); updateBoard();
      timer = setTimeout(() => { ball.setAttribute("visibility", "hidden"); trail.setAttribute("d", ""); ball.getAnimations().forEach((animation) => animation.cancel()); batter.classList.remove("swinging"); nextPitch(); }, 1150);
    }
    function swing() { if (!active || swung) return; outcome("swing", performance.now() - targetAt); }
    function start() {
      stopMotion(); pitch = 0; scoreValue = 0; homers = 0; farthest = 0; active = true; swung = false; root.classList.remove("home-run"); startButton.hidden = true; result.textContent = ""; result.className = "mlb-result"; distance.textContent = ""; updateBoard(); setMessage("比赛开始！等球进入甜蜜点再挥棒。"); nextPitch();
    }
    function finish() {
      active = false; stopMotion(); swingButton.disabled = true; startButton.hidden = false; startButton.textContent = "再打一局 ↻"; timingText.textContent = "FINAL"; report(`${homers} 支本垒打 · ${scoreValue.toLocaleString()} 分`, homers ? "homer" : "miss"); result.textContent = `${homers} HR`; result.className = `mlb-result ${homers ? "homer" : "miss"}`; document.querySelector("#gameScore").textContent = scoreValue.toLocaleString(); window.LumonPlay?.record(scoreValue); setMessage(homers ? `终场！${homers} 支本垒打，最远 ${farthest} 英尺。` : "十球结束。调整挥棒时机，再挑战一次。", homers > 0);
    }
    startButton.addEventListener("click", start); swingButton.addEventListener("click", swing);
    updateBoard();
    return { restart: start, focus: () => startButton.hidden ? swingButton.focus({ preventScroll: true }) : startButton.focus({ preventScroll: true }), key(event) { if (event.code === "Space" || event.key === "Enter") { event.preventDefault(); if (startButton.hidden) swing(); else if (!event.repeat) start(); } }, destroy() { active = false; stopMotion(); ball.getAnimations().forEach((animation) => animation.cancel()); } };
  }

  window.LumonPlay?.registerBuiltin("uno", { title: "UNO Lite", icon: "U", category: "arcade", scoreLabel: "手牌", bestLabel: "当前回合", help: "与 Lumon Bot 对战。按颜色或数字接牌；万能牌可随时出。摸牌后可打出新牌或结束回合。", unit: " 张" }, createUno);
  window.LumonPlay?.registerBuiltin("landlord", { title: "斗地主", icon: "♠", category: "puzzle", wide: true, scoreLabel: "手牌", bestLabel: "当前身份", help: "三人叫分斗地主。支持单张、对子、三张、三带一、三带对、顺子、连对、四带二、炸弹和王炸。点选手牌后出牌，P 不出，Enter 出牌。", unit: " 张" }, createLandlord);
  function addCard(id, title, category, note, color, order) {
    const card = document.createElement("article"); card.className = `game-card classic-card classic-${id} reveal`; card.dataset.game = id; card.dataset.category = category; card.dataset.search = `${title} ${note} 纸牌 对战 ${category}`; card.style.setProperty("--card-order", order);
    const favorite = document.createElement("button"); favorite.type = "button"; favorite.className = "favorite-button"; favorite.dataset.favorite = id; favorite.setAttribute("aria-label", `收藏 ${title}`); favorite.setAttribute("aria-pressed", "false"); favorite.innerHTML = '<svg><use href="#p-star"/></svg>';
    const launch = document.createElement("button"); launch.type = "button"; launch.className = "game-launch classic-launch"; launch.dataset.launch = id; launch.setAttribute("aria-label", `开始玩 ${title}`);
    const art = document.createElement("div"); art.className = `classic-art ${color}`;
    const index = document.createElement("span"); index.className = "mini-index"; index.textContent = `0${order + 1} / CARD GAME`;
    const graphic = document.createElement("div"); graphic.className = id === "mlb" ? "mlb-brand-lockup mlb-card-lockup" : "classic-art-cards";
    if (id === "mlb") {
      graphic.innerHTML = `${mlbLogoMarkup("mlb-logo-card")}<span class="mlb-letters" aria-label="MLB"><i>M</i><i>L</i><i>B</i></span>`;
    } else {
      const symbols = id === "uno" ? ["7", "↻", "+2"] : ["A♠", "K♦", "小王"];
      for (const symbol of symbols) { const tile = document.createElement("span"); tile.textContent = symbol; graphic.append(tile); }
    }
    art.append(index, graphic);
    const info = document.createElement("div"); info.className = "mini-card-info";
    const copy = document.createElement("div"); const eyebrow = document.createElement("span"); eyebrow.className = "micro-label"; eyebrow.textContent = id === "uno" ? "MATCH. CHANGE. SHOUT UNO." : id === "landlord" ? "CALL. PLAY. TAKE THE LEAD." : "READ THE PITCH. FIND THE SWEET SPOT.";
    const heading = document.createElement("h2"); heading.textContent = title;
    const description = document.createElement("p"); description.textContent = note;
    copy.append(eyebrow, heading, description);
    const arrow = document.createElement("span"); arrow.className = "small-arrow"; arrow.textContent = "↗"; info.append(copy, arrow);
    launch.append(art, info);
    const meta = document.createElement("div"); meta.className = "card-meta"; const tag = document.createElement("span"); tag.textContent = id === "uno" ? "玩家 vs 电脑" : id === "landlord" ? "三人本地对局" : "10 球全垒打挑战"; meta.append(tag); launch.append(meta);
    card.append(favorite, launch); document.querySelector("#gameGrid").append(card);
  }
  addCard("uno", "UNO Lite", "arcade", "颜色、数字、+2 与变色牌，和电脑来一局。", "uno-art", 4);
  addCard("landlord", "斗地主", "puzzle", "叫分做地主，和两位电脑玩家争先出完。", "landlord-art", 5);
  window.LumonPlay?.registerBuiltin("mlb", { title: "MLB 全垒打挑战", icon: "⚾", category: "arcade", wide: true, scoreLabel: "本局得分", bestLabel: "最高得分", help: "10 球挑战。等球进入击球区，按空格或点挥棒。时机越准，击球越远；挥空不计分。", unit: " 分" }, createMlb);
  addCard("mlb", "MLB 全垒打挑战", "arcade", "读懂来球时机，用一记挥棒把球送向看台。", "mlb-art", 6);
})();
