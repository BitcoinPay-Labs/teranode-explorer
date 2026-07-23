import { chromium } from "playwright-core";
const URL = "http://162.43.7.61:18300/";
const b = await chromium.connectOverCDP("http://localhost:29229");
const ctx = b.contexts()[0] || (await b.newContext());
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERR:", e.message));
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(4000);
const rows = await page.locator("table tbody tr").count();
console.log("home recent-block rows:", rows);

async function searchAndShot(term, name) {
  await page.fill(".searchbar input", term);
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await page.waitForTimeout(3500);
  console.log(name, "->", (await page.locator("main h2").first().textContent()));
  await page.screenshot({ path: `/home/ubuntu/repos/teranode-explorer/shot-${name}.png` });
}
await searchAndShot("ms5xkXH3Qdh1kbaSgaTn8ceDFU5LhTqFu4", "address");
await searchAndShot("26200", "block");
await page.close(); await b.close();
