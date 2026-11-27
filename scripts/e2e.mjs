// Browser play-through against a running client (local or deployed).
//   node scripts/e2e.mjs solo <url> [desktop|phone] [difficulty]
//   node scripts/e2e.mjs multi <url>
// Clicks like a player (random legal cards), records console errors, saves screenshots to
// e2e-output/ (git-ignored), and exits non-zero if anything goes wrong.
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";

const [mode = "solo", url = "http://localhost:4290", layout = "desktop", difficulty = "hard"] = process.argv.slice(2);
const out = "e2e-output";
mkdirSync(out, { recursive: true });
const errors = [];
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function contextOptions(kind) {
  return kind === "phone" ? { ...devices["Pixel 7"] } : { viewport: { width: 1366, height: 820 } };
}

async function newPlayer(browser, kind, name, label) {
  const ctx = await browser.newContext(contextOptions(kind));
  await ctx.addInitScript(
    ([n, d]) => {
      if (!localStorage.getItem("hearts.settings")) {
        localStorage.setItem("hearts.settings", JSON.stringify({ difficulty: d, playerName: n, pace: 0.5, rules: { targetScore: 100 } }));
      }
      localStorage.setItem("hearts.muted", "1");
    },
    [name, difficulty]
  );
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${label} pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/WebSocket connection|ERR_CONNECTION|Failed to load resource/.test(m.text())) errors.push(`${label} console: ${m.text()}`);
  });
  return { ctx, page, label };
}

/** Take one action if one is due. Returns "over" when the game-over dialog is up. */
async function step(page, label) {
  const over = page.getByRole("dialog").filter({ hasText: /You win!|Game over|A shared win!/ });
  if (await over.count()) return "over";
  const moon = page.getByRole("button", { name: /\+26 to everyone else/ });
  if (await moon.count()) {
    log(label, "shot the moon");
    await moon.click({ timeout: 5000 });
    return "moon";
  }
  const deal = page.getByRole("button", { name: /Deal next hand/ });
  if ((await deal.count()) && (await deal.isEnabled())) {
    await page.screenshot({ path: `${out}/${label}-summary.png` });
    await deal.click({ timeout: 5000 });
    return "deal";
  }
  const passBtn = page.locator(".pass-btn");
  if (await passBtn.count()) {
    const selected = await page.locator(".hand-card.is-selected").count();
    if (selected < 3) {
      const cards = page.locator(".hand-card:not(.is-selected)");
      await cards.nth(Math.floor(Math.random() * (await cards.count()))).click({ force: true, timeout: 5000, position: { x: 8, y: 24 } });
      return "select";
    }
    await passBtn.click({ timeout: 5000 });
    return "pass";
  }
  const playable = page.locator(".me.is-turn .hand-card.is-playable");
  const n = await playable.count();
  if (n) {
    await playable.nth(Math.floor(Math.random() * n)).click({ force: true, timeout: 5000, position: { x: 8, y: 24 } });
    return "play";
  }
  return "idle";
}

async function playUntil(page, label, done, timeoutMs) {
  const started = Date.now();
  let plays = 0;
  let idleSince = Date.now();
  while (Date.now() - started < timeoutMs) {
    const r = await step(page, label).catch((e) => `error:${e.message.split("\n")[0]}`);
    if (r.startsWith("error")) {
      log(label, r);
      await page.screenshot({ path: `${out}/${label}-error.png` }).catch(() => {});
    }
    if (r === "play") plays++;
    if (r !== "idle") idleSince = Date.now();
    if (Date.now() - idleSince > 90_000) throw new Error(`${label}: nothing happened for 90s`);
    if (r === "over" || (await done())) return plays;
    await page.waitForTimeout(r === "idle" ? 200 : 120);
  }
  throw new Error(`${label}: timed out`);
}

async function solo() {
  const browser = await chromium.launch();
  const p = await newPlayer(browser, layout, "Tester", `solo-${layout}`);
  await p.page.goto(url);
  await p.page.screenshot({ path: `${out}/${p.label}-home.png` });
  await p.page.getByRole("button", { name: /New game/ }).click();
  await p.page.waitForSelector(".hand-card");
  await p.page.waitForTimeout(1200);
  await p.page.screenshot({ path: `${out}/${p.label}-passing.png` });
  let shotMid = false;
  const plays = await playUntil(
    p.page,
    p.label,
    async () => {
      if (!shotMid && (await p.page.locator(".trick-card").count()) >= 3) {
        shotMid = true;
        await p.page.screenshot({ path: `${out}/${p.label}-trick.png` });
      }
      return false;
    },
    25 * 60_000
  );
  await p.page.waitForTimeout(1000);
  await p.page.screenshot({ path: `${out}/${p.label}-gameover.png` });
  const text = await p.page.getByRole("dialog").innerText();
  log(p.label, `finished after ${plays} plays:`, text.replace(/\s+/g, " ").slice(0, 200));
  // Scoreboard after the game.
  await p.page.getByRole("button", { name: "Main menu" }).click();
  await browser.close();
}

async function multi() {
  const browser = await chromium.launch();
  const a = await newPlayer(browser, "desktop", "Alice", "host");
  const b = await newPlayer(browser, "phone", "Bob", "guest");
  await a.page.goto(url);
  await a.page.getByRole("button", { name: /Create or join a room/ }).click();
  const t0 = Date.now();
  await a.page.getByRole("button", { name: "Create room" }).and(a.page.locator(":enabled")).waitFor({ timeout: 120_000 });
  log("server ready after", Date.now() - t0, "ms");
  await a.page.getByRole("button", { name: "Create room" }).click();
  const code = (await a.page.locator(".room-code").innerText()).replace(/\s+/g, "");
  log("room", code);
  await b.page.goto(`${url}/?room=${code}`);
  await b.page.getByRole("button", { name: "Join", exact: true }).and(b.page.locator(":enabled")).waitFor({ timeout: 120_000 });
  await b.page.getByRole("button", { name: "Join", exact: true }).click();
  await a.page.getByRole("button", { name: /Start with 2 players/ }).click();
  await Promise.all([a.page.waitForSelector(".hand-card"), b.page.waitForSelector(".hand-card")]);
  await a.page.waitForTimeout(1500);
  await a.page.screenshot({ path: `${out}/multi-host-start.png` });
  await b.page.screenshot({ path: `${out}/multi-guest-start.png` });

  const handA = await a.page.locator(".hand-card").evaluateAll((els) => els.map((e) => e.getAttribute("data-card")));
  const handB = await b.page.locator(".hand-card").evaluateAll((els) => els.map((e) => e.getAttribute("data-card")));
  if (handA.some((c) => handB.includes(c))) throw new Error("hands overlap between players");
  log("hands are private and distinct:", handA.length, handB.length);

  // Both play until 4 tricks are done.
  const tricksDone = async (page) => (await page.locator(".opp-card").count()) <= 3 * 9 && (await page.locator(".hand-card").count()) <= 9;
  await Promise.all([
    playUntil(a.page, "host", () => tricksDone(a.page), 5 * 60_000),
    playUntil(b.page, "guest", () => tricksDone(b.page), 5 * 60_000)
  ]);

  // Refresh the guest: the seat and hand must come back.
  const before = await b.page.locator(".hand-card").evaluateAll((els) => els.map((e) => e.getAttribute("data-card")).sort().join());
  await b.page.reload();
  await b.page.waitForSelector(".hand-card", { timeout: 120_000 });
  const after = await b.page.locator(".hand-card").evaluateAll((els) => els.map((e) => e.getAttribute("data-card")).sort().join());
  log("reconnect after refresh:", before === after ? "same hand" : `hand changed (${before} -> ${after}), may be a play in between`);
  if (!(await b.page.locator(".hand-card").count())) throw new Error("guest lost its hand after refresh");

  // Guest drops for good: a bot must take over and the game must continue.
  await b.ctx.close();
  log("guest closed; waiting for bot takeover");
  await a.page.getByText(/Reconnecting… bot in/).first().waitFor({ timeout: 20_000 });
  await a.page.screenshot({ path: `${out}/multi-host-reconnecting.png` });
  await a.page.getByText("Bob (bot)").first().waitFor({ timeout: 60_000 });
  log("bot took Bob's seat");
  await a.page.screenshot({ path: `${out}/multi-host-bot-takeover.png` });
  // Finish the hand with the bot in Bob's seat.
  await playUntil(a.page, "host", async () => (await a.page.getByRole("button", { name: /Deal next hand/ }).count()) > 0, 6 * 60_000);
  await a.page.screenshot({ path: `${out}/multi-host-hand-summary.png` });
  log("hand finished with the bot seated");
  await browser.close();
}

try {
  if (mode === "multi") await multi();
  else await solo();
  if (errors.length) {
    console.error("Console errors:\n" + errors.join("\n"));
    process.exitCode = 1;
  } else log("OK, no console errors");
} catch (e) {
  console.error("FAILED:", e.message);
  if (errors.length) console.error(errors.join("\n"));
  process.exitCode = 1;
}
