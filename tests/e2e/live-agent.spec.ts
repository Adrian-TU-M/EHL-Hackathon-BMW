import { test, expect } from "@playwright/test";
test("live Ollama competitor analysis and PM-triggered council", async ({
  page,
}) => {
  test.skip(
    (globalThis as unknown as { process: { env: Record<string, string> } })
      .process.env.LIVE_OLLAMA !== "1",
    "Explicit opt-in: runs real local inference.",
  );
  test.setTimeout(1200000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let debates = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/council/debate"))
      debates++;
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start Product Analysis", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm scope & begin" }).click();
  await page
    .getByRole("link", { name: "Competitor intelligence", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "What could BMW do better?" }),
  ).toBeVisible();
  await expect(page.getByLabel("Competitor model")).toHaveValue(
    "A6 Sportback e-tron",
  );
  for (const logo of await page.locator(".cx-brand-picker img").all()) {
    expect(
      await logo.evaluate(
        (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
      ),
    ).toBe(true);
  }
  await page.screenshot({
    path: "test-results/live-competitor-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/live-competitor-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1440, height: 1050 });
  const resumeJob = (
    globalThis as unknown as { process: { env: Record<string, string> } }
  ).process.env.RESUME_ANALYSIS_JOB;
  if (resumeJob)
    await page.evaluate(
      (id) => localStorage.setItem("bmw-live-analysis-job", id),
      resumeJob,
    );
  else await page.getByRole("button", { name: "Analyze this feature" }).click();
  await page.reload(); // Persisted job resumes polling; inference is not restarted.
  await expect(
    page.getByRole("link", { name: "Bring to council" }),
  ).toBeVisible({ timeout: 420000 });
  await page.screenshot({
    path: "test-results/live-analysis-result.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(debates).toBe(0);
  await page.getByRole("link", { name: "Bring to council" }).click();
  await expect(
    page.getByRole("button", { name: "Start live debate" }),
  ).toBeEnabled();
  expect(debates).toBe(0);
  await page.getByRole("button", { name: "Start live debate" }).click();
  expect(debates).toBe(1);
  await page.reload();
  await expect
    .poll(
      async () => {
        const id = await page.evaluate(() =>
          localStorage.getItem("bmw-live-debate-job"),
        );
        if (!id) return "pending";
        const job = await (await page.request.get(`/api/jobs/${id}`)).json();
        if (job.status === "failed") throw new Error(job.error);
        return job.status;
      },
      { timeout: 950000, intervals: [3000] },
    )
    .toBe("succeeded");
  await expect(
    page.getByRole("heading", { name: "Council transcript", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".lc-turn")).toHaveCount(6);
  await expect(page.locator(".lc-challenge")).not.toHaveCount(0);
  await expect(page.locator(".lc-competitor").last()).toContainText(
    "Responding to:",
  );
  await expect(page.locator(".lc-judge")).toContainText("Responding to:");
  await page.screenshot({
    path: "test-results/live-council.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(errors).toEqual([]);
  console.log("Live source URL:", page.url());
  console.log(
    "Debate job:",
    await page.evaluate(() => localStorage.getItem("bmw-live-debate-job")),
  );
});
