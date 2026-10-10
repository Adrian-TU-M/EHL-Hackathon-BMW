import { test, expect } from "@playwright/test";

test.skip(
  !process.env.JUDGE_E2E,
  "Run with JUDGE_E2E=1 and an explicitly configured demo backend on port 8000.",
);

async function openJudge(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start Product Analysis", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm scope & begin" }).click();
  await page.goto("/decisions");
  return page.getByRole("region", { name: "Judge Agent review" });
}

test("FastAPI manual checkpoints, whole-council chat and versioned feature edits", async ({
  page,
}) => {
  const panel = await openJudge(page);
  await panel
    .getByRole("button", { name: "Start Judge council", exact: true })
    .click();
  await expect(panel).toContainText("DEMO BACKEND");
  await expect(panel).toContainText("paused · topic");
  await panel
    .getByLabel("Review note")
    .fill("Reviewed the stage and evidence limitations.");
  for (const stage of [
    "perspectives",
    "challenge",
    "assessment",
    "revision",
    "proposal",
    "review",
  ]) {
    await panel.getByRole("button", { name: "Continue after review" }).click();
    await expect(panel).toContainText(
      stage === "review" ? "complete · review" : `paused · ${stage}`,
    );
  }
  await expect(panel).toContainText("Unknown/100 priority");
  await page
    .locator(".requirement-card")
    .first()
    .getByRole("button", { name: "Review" })
    .click();
  await page
    .getByLabel("Customer-facing requirement")
    .fill("Improve controls through a targeted usability redesign.");
  await page
    .getByLabel("Decision rationale")
    .fill("A smaller design change addresses my concern.");
  await page.getByRole("button", { name: "Save new version" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(panel).toContainText(
    "Edited feature requires a fresh Judge assessment.",
  );
  await panel.getByRole("button", { name: "Continue after review" }).click();
  await expect(panel).toContainText("paused · assessment");
  await panel
    .getByLabel("Your question or proposed feature change")
    .fill("I dislike complex controls. What are the trade-offs?");
  await panel.getByRole("button", { name: "Ask the whole council" }).click();
  await expect(panel).toContainText("round 3");
  await expect(panel).toContainText("paused · perspectives");
  await panel.getByText(/Specialist statements and stage history/).click();
  await expect(panel).toContainText("PM question: I dislike complex controls.");
  await page.reload();
  await panel.getByRole("button", { name: "Refresh backend state" }).click();
  await expect(panel).toContainText("round 3");
});

test("FastAPI auto debate pauses on consequential uncertainty and respects final PM approval", async ({
  page,
}) => {
  const panel = await openJudge(page);
  await panel.getByLabel("Judge review mode").selectOption("auto");
  await panel
    .getByRole("button", { name: "Start Judge council", exact: true })
    .click();
  await expect(panel).toContainText(
    "Consequential uncertainty remains; PM review required.",
  );
  await panel
    .getByLabel("Review note")
    .fill("Acknowledged demo evidence; continue to provisional review.");
  await panel.getByRole("button", { name: "Continue after review" }).click();
  await expect(panel).toContainText("complete · review");
  await panel.screenshot({
    path: "test-results/judge-review.png",
    animations: "disabled",
  });
  await page
    .locator(".requirement-card")
    .first()
    .getByRole("button", { name: "Review" })
    .click();
  await page.getByLabel("Your decision").selectOption("Deferred");
  await page
    .getByLabel("Decision rationale")
    .fill("Real evidence is required before choosing this feature.");
  await page.getByRole("button", { name: "Record decision" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator(".requirement-card").first()).toContainText(
    "Deferred",
  );
  await panel.getByText(/Specialist statements and stage history/).click();
  await expect(panel).toContainText("defer REQ-");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
});
