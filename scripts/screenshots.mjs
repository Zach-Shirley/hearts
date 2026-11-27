// README screenshots: node scripts/screenshots.mjs <url> <outDir>
// Captures a settled trick (three cards down, your turn) at desktop and phone sizes.
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";

const [url = "http://localhost:4290", outDir = "e2e-output"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

async function capture(name, options) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext(options);
  await ctx.addInitScript(() => {
    localStorage.setItem("hearts.settings", JSON.stringify({ difficulty: "hard", playerName: "You", pace: 0.5, rules: { targetScore: 100 } }));
    localStorage.setItem("hearts.muted", "1");
  });
  const page = await ctx.newPage();
  await page.goto(url);
  await page.getByRole("button", { name: /New game/ }).click();
  for (let i = 0; i < 3000; i++) {
    const pass = page.locator(".pass-btn");
    if (await pass.count()) {
      const sel = await page.locator(".hand-card.is-selected").count();
      if (sel < 3) await page.locator(".hand-card:not(.is-selected)").last().click({ force: true });
      else await pass.click();
    } else if (await page.locator(".me.is-turn .hand-card.is-playable").count()) {
      const onTable = await page.locator(".trick-card").count();
      if (onTable === 3 && (await page.locator(".tricks-count, .trick-card.is-winning").count()) === 0) {
        await page.waitForTimeout(700);
        await page.screenshot({ path: `${outDir}/${name}.png` });
        break;
      }
      await page.locator(".me.is-turn .hand-card.is-playable").first().click({ force: true });
    }
    await page.waitForTimeout(150);
  }
  await browser.close();
}

await capture("readme-desktop-trick", { viewport: { width: 1366, height: 820 } });
await capture("readme-phone-trick", { ...devices["Pixel 7"] });
console.log("done");
