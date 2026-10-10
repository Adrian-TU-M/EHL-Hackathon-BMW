import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import competitorSources from "../../backend/evidence/competitors.json" with { type: "json" };
async function start(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start Product Analysis", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm scope & begin" }).click();
  await expect(
    page.getByRole("heading", { name: "A clearer view of what’s next." }),
  ).toBeVisible();
}
async function assertFits(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}
test("BMW vehicle selection, real model embed and scoped analysis", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator(".showroom-hero .vehicle-photo")).toBeVisible();
  expect(
    await page
      .locator(".showroom-hero .vehicle-photo")
      .evaluate(
        (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
      ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/home-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: /F70.*Sport hatchback/ }).click();
  await expect(page.getByLabel("Series", { exact: true })).toHaveValue("F70");
  await expect(page.getByLabel("Powertrain", { exact: true })).toHaveValue(
    "Combustion",
  );
  await expect(page.locator(".showroom-hero .vehicle-photo")).toHaveAttribute(
    "src",
    "/images/bmw-f70.webp",
  );
  await page
    .getByRole("button", { name: "Explore in 3D", exact: true })
    .click();
  await expect(page.locator(".model-embed iframe")).toHaveAttribute(
    "src",
    /5e5371e856ef4496b0185704b325704a/,
  );
  await page
    .getByRole("button", { name: "Close 3D view", exact: true })
    .click();
  await page.getByRole("button", { name: /G70.*Luxury saloon/ }).click();
  await expect(page.locator(".showroom-hero .vehicle-photo")).toHaveAttribute(
    "src",
    "/images/bmw-g70.webp",
  );
  await page.getByRole("button", { name: /G60.*Executive saloon/ }).click();
  await page.getByLabel("Powertrain", { exact: true }).selectOption("Electric");
  await page.getByLabel("Market", { exact: true }).selectOption("China");
  await page
    .getByRole("button", { name: "High impact, lower effort", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Start Product Analysis", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("China");
  await page.getByRole("button", { name: "Confirm scope & begin" }).click();
  await expect(
    page.getByRole("heading", { name: "A clearer view of what’s next." }),
  ).toBeVisible();
  await expect(page.locator(".context-label")).toContainText("China");
  await expect(page.locator(".vehicle-panel .vehicle-photo")).toBeVisible();
  await expect(page.locator(".council-preview canvas")).toBeVisible();
  await page.waitForTimeout(1200);
  await page.screenshot({
    path: "test-results/overview-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await assertFits(page);
  expect(errors).toEqual([]);
});
test("specialist pages filter actual fixture records and disclose sources", async ({
  page,
}) => {
  await page.route("**/api/competitor/sources", (route) =>
    route.fulfill({
      json: {
        records: competitorSources.map((r) => ({
          ...r,
          eligible_for_current_search:
            r.reference_status === "current_reference",
        })),
      },
    }),
  );
  await page.route("**/api/competitor/status", (route) =>
    route.fulfill({
      json: {
        analysis_ready: false,
        model: "qwen3:8b",
        ollama_error: "Offline UI test",
      },
    }),
  );
  await start(page);
  await page
    .getByRole("link", { name: "Customer intelligence", exact: true })
    .click();
  await expect(page.locator(".evidence-card")).toHaveCount(21);
  await page
    .getByLabel("Feedback type", { exact: true })
    .selectOption("Positive");
  await expect(page.locator(".evidence-card")).toHaveCount(7);
  await page.getByLabel("Search customer evidence").fill("quiet");
  await expect(page.locator(".evidence-card")).toHaveCount(1);
  await page.locator(".evidence-card").click();
  await expect(page.getByRole("dialog")).toContainText("SYNTHETIC DEMO");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("link", { name: "Market trends", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Understand the direction." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "United States", exact: true })
    .click();
  await page.getByLabel("Future demand sensitivity").fill("20");
  await expect(page.locator(".scenario-adjustment")).toContainText("+20%");
  await page.waitForTimeout(1200);
  await page.screenshot({
    path: "test-results/market-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("link", { name: "Competitor intelligence", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "What could BMW do better?" }),
  ).toBeVisible();
  await expect(page.getByLabel("Competitor model")).toHaveValue(
    "A6 Sportback e-tron",
  );
  await page.getByRole("button", { name: "BYD", exact: true }).click();
  await expect(page.getByLabel("Competitor model")).toHaveValue("SEAL");
  await expect(page.locator(".cx-comparison")).toContainText("fixed");
  await expect(page.locator(".cx-bmw")).toContainText("Gap not yet verified");
  await expect(page.locator(".cx-success")).toContainText(
    "No attributable percentage",
  );
  await page.getByRole("button", { name: "XPENG", exact: true }).click();
  await expect(page.locator(".cx-comparison")).toContainText("12 minutes");
  for (const logo of await page.locator(".cx-brand-picker img").all()) {
    expect(
      await logo.evaluate(
        (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await assertFits(page);
});
test("council pause, interruption, challenge, bounded stages and PM handoff", async ({
  page,
}) => {
  await start(page);
  await page.getByRole("link", { name: "Agent council", exact: true }).click();
  await page.goto("/council?demo=1");
  await page.clock.install();
  await page
    .getByRole("button", { name: "Start discussion", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Pause discussion" }),
  ).toBeVisible();
  await page.clock.fastForward(4300);
  await page.getByRole("button", { name: "Pause discussion" }).click();
  const speaker = await page.locator(".speaker-card>p").textContent();
  await page.clock.fastForward(12000);
  expect(await page.locator(".speaker-card>p").textContent()).toBe(speaker);
  await page.getByRole("button", { name: "Challenge", exact: true }).click();
  await page
    .getByLabel("What needs closer examination?")
    .fill("Validate prevalence using unique feedback records.");
  await page.getByRole("button", { name: "Record challenge" }).click();
  await expect(page.locator(".challenge-record")).toContainText(
    "Validate prevalence",
  );
  await page.getByRole("button", { name: "Resume discussion" }).click();
  await page.getByRole("button", { name: "Interrupt", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Resume discussion" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/council-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Resume discussion" }).click();
  for (let i = 0; i < 11; i++) await page.clock.runFor(4300);
  await expect(
    page.getByRole("button", { name: "Continue to PM review" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Expand debate" }).click();
  await expect(page.locator(".transcript-event")).toHaveCount(11);
  await page.getByRole("button", { name: "Continue to PM review" }).click();
  await expect(
    page.getByRole("heading", { name: "Shape the next generation." }),
  ).toBeVisible();
  await expect(
    page.locator(".requirement-list").getByText("Approved", { exact: true }),
  ).toHaveCount(0);
});
test("review, versioning, evidence exclusion, scoring, persistence, audit and PDF export", async ({
  page,
}) => {
  await start(page);
  await page
    .getByRole("link", { name: "Decisions & scenarios", exact: true })
    .click();
  const first = page.locator(".requirement-card").first();
  await first.getByRole("button", { name: "Review", exact: true }).click();
  await page
    .getByLabel("Your decision", { exact: true })
    .selectOption("Approved");
  await expect(
    page.getByRole("button", { name: "Record decision" }),
  ).toBeDisabled();
  await page
    .getByLabel("Decision rationale", { exact: false })
    .fill("Approved for demonstration, pending real data validation.");
  await page.getByRole("button", { name: "Record decision" }).click();
  await expect(first).toContainText("Approved");
  await first.getByRole("button", { name: "Revisit" }).click();
  await page
    .getByLabel("Customer-facing requirement", { exact: true })
    .fill(
      "Give drivers persistent and accessible essential controls, with clear feedback.",
    );
  await page
    .getByLabel("Decision rationale", { exact: false })
    .fill("Clarify the intended user outcome.");
  await page.getByRole("button", { name: "Save new version" }).click();
  await expect(first).toContainText("v2");
  await expect(first).toContainText("Pending review");
  await first.getByRole("button", { name: /active sources/ }).click();
  await page
    .getByRole("button", { name: "Challenge / exclude this evidence" })
    .click();
  await page
    .getByLabel("Why should this evidence be excluded?")
    .fill("Synthetic source cannot validate actual prevalence.");
  await page
    .getByRole("button", { name: "Exclude and record rationale" })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Excluded from active support.",
  );
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(first).toContainText("v3");
  await expect(first).toContainText("3 active sources");
  await page.getByRole("button", { name: "Lower effort", exact: true }).click();
  await expect(page.locator(".strategy-bar")).toContainText(
    "Low-effort improvements",
  );
  await page.getByRole("button", { name: "Scoring preferences" }).click();
  await page.getByLabel("Customer need weight").fill("0");
  await page.getByRole("button", { name: "Apply & record weights" }).click();
  await page.reload();
  await expect(page.locator(".strategy-bar")).toContainText(
    "Custom priorities",
  );
  await page.waitForTimeout(500);
  await page.screenshot({
    path: "test-results/decisions-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("link", { name: "Audit trail", exact: true }).click();
  await expect(page.locator(".timeline")).toContainText("Requirement revised");
  await expect(page.locator(".timeline")).toContainText("Evidence excluded");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export report" }).click();
  const report = await download;
  await report.saveAs("test-results/BMW-NEXT-report.pdf");
  expect(report.suggestedFilename()).toMatch(/\.pdf$/);
  await assertFits(page);
});
test("mobile layout, navigation, deep links and reduced motion", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Start Product Analysis", exact: true }),
  ).toBeVisible();
  await assertFits(page);
  await expect(page.getByText("Preparing the studio…")).toBeHidden();
  await page.waitForTimeout(500);
  await page.screenshot({
    path: "test-results/home-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Start Product Analysis", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm scope & begin" }).click();
  await assertFits(page);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Agent council", exact: true }).click();
  await page.goto("/council?demo=1");
  await assertFits(page);
  await page.screenshot({
    path: "test-results/council-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.goto("/decisions");
  await expect(
    page.getByRole("heading", { name: "Shape the next generation." }),
  ).toBeVisible();
  await assertFits(page);
  await page.screenshot({
    path: "test-results/decisions-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
});
