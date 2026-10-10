import { test, expect } from "@playwright/test";
import type { Route } from "@playwright/test";

/** Council with the live Customer Agent. The backend is mocked here so the test is fast and
 * deterministic; the real qwen3:8b path is the same request (POST /customer/perspective). */
const quote = (id: string) => ({
  id,
  domain: "customer",
  source: "G60_feedback_hackathon.xlsx · Source B",
  location: `G60_feedback_hackathon.xlsx rows 7 · feedback ID ${id}`,
  publishedAt: "unknown",
  provenance: "bmw-supplied",
  vehicle: "G60",
  market: "Europe",
  country: "DE",
  powertrain: "Electric",
  category: "Touch screen, operation",
  theme: "Displays & infotainment",
  topic: "Displays",
  subcategories: ["Not user-friendly"],
  type: "Complaint",
  feedbackTypes: ["Difficult to Use"],
  passage: `Test passage for ${id}: the menus are hard to find while driving.`,
  classificationRows: 1,
  channel: "Source B",
  severity: null,
  quantitative: null,
});

test("council uses the live Customer Agent for customer turns and PM challenges", async ({ page }) => {
  const requests: { stage: string; challenge: string }[] = [];
  await page.route("**/customer-api/health", (r: Route) => r.fulfill({ json: { ollama: { reachable: true } } }));
  await page.route("**/customer-api/customer/perspective", async (r: Route) => {
    const body = r.request().postDataJSON();
    requests.push({ stage: body.stage, challenge: body.challenge ?? "" });
    const id = `G60-00${requests.length}`;
    await r.fulfill({
      json: {
        id: `customer-${body.stage}`,
        stage: body.stage,
        actor: "customer",
        statement: `LIVE ${body.stage} turn ${requests.length}.`,
        recommendation: "Keep the menus shallow.",
        evidenceBase: "Evidence base: 2 of 19 G60 · Europe feedback records on this topic (2 complaint); thin evidence.",
        evidenceIds: [id],
        assumption: "Supplied feedback only.",
        uncertainties: [],
        quantitative: [],
        evidence: [quote(id)],
        model: "ollama:qwen3:8b",
      },
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Start Product Analysis", exact: true }).click();
  await page.getByRole("button", { name: "Confirm scope & begin" }).click();
  await page.getByRole("link", { name: "Agent council", exact: true }).click();
  await page.clock.install();
  await page.getByRole("button", { name: "Start discussion", exact: true }).click();
  await expect(page.getByText("LIVE CUSTOMER AGENT · OTHER AGENTS SCRIPTED")).toBeVisible();
  await expect.poll(() => requests.length).toBe(3); // perspectives, challenge reply, revision answer
  expect(requests.map((r) => r.stage)).toEqual(["perspectives", "challenge", "revision"]);
  expect(requests[1].challenge).toContain("challenge"); // the competitor's challenge is passed on

  await page.clock.runFor(4300); // moderator → customer
  await expect(page.locator(".speaker-card>p")).toContainText("LIVE perspectives turn");
  await expect(page.getByTestId("live-turn")).toContainText("qwen3:8b");
  await expect(page.getByTestId("evidence-base")).toContainText("2 of 19");
  await expect(page.locator(".speaker-card>p")).toContainText("Recommendation: Keep the menus shallow.");
  await expect(page.getByTestId("live-source").first()).toContainText("G60-001");
  await page.getByTestId("live-source").first().click();
  await expect(page.locator("dialog.ci-drawer")).toContainText("Test passage for G60-001");
  await page.getByRole("button", { name: "Close evidence drawer" }).click();

  // A PM challenge gets a live customer reply as the next turn.
  await page.getByRole("button", { name: "Challenge", exact: true }).click();
  await page.getByLabel("What needs closer examination?").fill("How many customers actually said this?");
  await page.getByRole("button", { name: "Record challenge" }).click();
  await expect.poll(() => requests.length).toBe(4);
  expect(requests[3]).toEqual({ stage: "challenge", challenge: "How many customers actually said this?" });
  await page.getByRole("button", { name: "Resume discussion" }).click();
  await page.clock.runFor(4300);
  await expect(page.locator(".speaker-card>p")).toContainText("LIVE challenge turn 4");

  for (let i = 0; i < 12; i++) await page.clock.runFor(4300);
  await expect(page.getByRole("button", { name: "Continue to PM review" })).toBeEnabled();
  await page.getByRole("button", { name: "Expand debate" }).click();
  await expect(page.locator(".transcript-event")).toHaveCount(12);
  await expect(page.locator(".transcript-event .council-live-tag")).toHaveCount(4);
});
