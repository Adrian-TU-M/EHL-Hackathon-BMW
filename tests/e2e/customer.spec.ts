import { test, expect } from "@playwright/test";
import type { Locator } from "@playwright/test";

/** Customer page: two ranked tables (red = dislikes, green = wants/likes), most mentioned first.
 * Runs against the live Customer Agent backend when it is up, else the DEMO fallback. */
async function counts(table: Locator) {
  const cells = await table.locator(".ci-rank-count strong").allTextContents();
  return cells.map((c) => Number(c.replace(/,/g, "")));
}

test("customer rankings: filters, sort order and evidence drawer", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Start Product Analysis", exact: true }).click();
  await page.getByRole("button", { name: "Confirm scope & begin" }).click();
  await page.getByRole("link", { name: "Customer intelligence", exact: true }).click();

  await expect(page.locator(".ci-status")).toHaveText(/^(Demo data|Live · BMW data)$/);
  await page.getByLabel("Vehicle", { exact: true }).selectOption("G60");
  await page.getByLabel("Market", { exact: true }).selectOption("United States");
  await page.getByLabel("Powertrain", { exact: true }).selectOption("All");
  await expect(page.getByTestId("scope-line")).toContainText("G60 · US · all powertrains");

  const red = page.getByTestId("ranking-red");
  const green = page.getByTestId("ranking-green");
  await expect(red.getByTestId("rank-row").first()).toBeVisible();
  await expect(green.getByTestId("rank-row").first()).toBeVisible();
  for (const table of [red, green]) {
    const n = await counts(table);
    expect(n.length).toBeGreaterThan(0);
    expect(n).toEqual([...n].sort((a, b) => b - a)); // most mentioned first
  }

  // Click the most-disliked feature: drawer with its original comments.
  await red.getByTestId("rank-row").first().click();
  const drawer = page.locator("dialog.ci-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText("How this number is calculated");
  await expect(drawer.getByTestId("quote").first()).toContainText(/“.+”/);
  await page.screenshot({ path: "test-results/customer-drawer.png", animations: "disabled" });
  await page.getByRole("button", { name: "Close evidence drawer" }).click();
  await expect(drawer).toBeHidden();

  // Keyboard: rows are focusable and open with Enter.
  await green.getByTestId("rank-row").first().focus();
  await page.keyboard.press("Enter");
  await expect(drawer.getByTestId("quote").first()).toBeVisible();
  await page.keyboard.press("Escape");

  // Top 5 rows expand inline with example comments and their source; row 6 has no button.
  for (const table of [red, green]) {
    await expect(table.getByTestId("expand-row")).toHaveCount(Math.min(5, await table.getByTestId("rank-row").count()));
    await table.getByTestId("expand-row").first().click();
    const detail = table.getByTestId("detail-row");
    await expect(detail.getByTestId("detail-quote").first()).toContainText(/“.+”/);
    await expect(detail.getByTestId("detail-quote").first()).toContainText("Source:");
    await expect(drawer).toBeHidden(); // expanding does not open the drawer
  }
  // Filters scroll away with the page; no "continue to market trends" link at the bottom.
  expect(await page.locator(".ci-filters").evaluate((el) => getComputedStyle(el).position)).not.toMatch(/sticky|fixed/);
  await expect(page.locator(".journey-next")).toHaveCount(0);

  await page.screenshot({ path: "test-results/customer-desktop.png", fullPage: true, animations: "disabled" });
  expect(errors).toEqual([]);
});
