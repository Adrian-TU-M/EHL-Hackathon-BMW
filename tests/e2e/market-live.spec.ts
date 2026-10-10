import { test, expect } from "@playwright/test";
const env = (
  globalThis as unknown as { process: { env: Record<string, string> } }
).process.env;
test("Market: real data, responsive UI and explicit Qwen council", async ({
  page,
}) => {
  test.setTimeout(1500000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let debatePosts = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/council/debate"))
      debatePosts++;
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start Product Analysis", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm scope & begin" }).click();
  await page.getByRole("link", { name: "Market trends", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Market trends." }),
  ).toBeVisible();
  await expect(page.locator(".mt-feature-title")).toContainText(
    "Less distraction",
  );
  await expect(page.locator(".mt-example")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Electrification", exact: true })
    .click();
  await expect(page.locator(".mt-signal-number")).toContainText("21.7%");
  await expect(
    page.getByRole("button", { name: "Analyze this trend" }),
  ).toBeEnabled();
  await page.screenshot({
    path: "/tmp/market-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "China", exact: true }).click();
  await expect(page.locator(".mt-signal-number")).toContainText("~55%");
  await expect(page.locator(".mt-change")).toContainText("-12.5%");
  await page
    .getByRole("button", { name: "Digital experience", exact: true })
    .click();
  await expect(page.locator(".mt-signal-summary")).toContainText(
    "No reviewed industry signal",
  );
  await page.getByRole("button", { name: "Europe", exact: true }).click();
  await expect(page.locator(".mt-signal-card")).toContainText("Announcement");
  await page
    .getByRole("button", { name: "Electrification", exact: true })
    .click();
  await page.locator("#market-context > summary").click();
  await page.getByRole("button", { name: "Model inputs", exact: true }).click();
  await expect(page.locator(".mt-planning")).toContainText("127,000");
  await expect(page.locator(".mt-chart")).not.toHaveAttribute(
    "aria-label",
    /2030/,
  );
  await page.getByRole("button", { name: "BMW Group", exact: true }).click();
  await page.locator("#market-context > summary").click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/market-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .locator(".mt-laser")
      .first()
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page
    .getByRole("button", { name: "Feature trends", exact: true })
    .click();
  await page.getByRole("link", { name: "Evidence & limits" }).click();
  await expect(page.locator(".mt-study-heading")).toBeVisible();
  await page
    .getByRole("button", { name: "Check online sources", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Check online sources", exact: true }),
  ).toBeEnabled({ timeout: 65000 });
  await expect(page.locator(".mt-source-panel")).toContainText("G60 study");
  await page.locator("#market-context > summary").click();
  await page.screenshot({
    path: "/tmp/market-features-desktop.png",
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
    path: "/tmp/market-features-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1440, height: 1050 });
  expect(debatePosts).toBe(0);
  if (env.LIVE_OLLAMA === "1") {
    if (env.RESUME_MARKET_JOB)
      await page.evaluate(
        (id) => localStorage.setItem("bmw-live-market-job", id),
        env.RESUME_MARKET_JOB,
      );
    else await page.getByRole("button", { name: "Analyze this trend" }).click();
    await page.reload();
    async function finish(key: string, timeout: number) {
      await expect
        .poll(
          async () => {
            const id = await page.evaluate((k) => localStorage.getItem(k), key);
            if (!id) return "pending";
            const response = await page.request.get(`/api/jobs/${id}`);
            if (response.status() === 404) return "pending";
            const job = await response.json();
            if (job.status === "failed") throw new Error(job.error);
            return job.status;
          },
          { timeout, intervals: [2500] },
        )
        .toBe("succeeded");
    }
    await finish("bmw-live-market-job", 600000);
    const analysisJobId = await page.evaluate(() =>
      localStorage.getItem("bmw-live-market-job"),
    );
    const analysisJob = await (
      await page.request.get(`/api/jobs/${analysisJobId}`)
    ).json();
    expect(analysisJob.result.feature_id).toBe("cockpit");
    expect(
      analysisJob.result.position.claims.some((c: { evidence_ids: string[] }) =>
        c.evidence_ids.some((id) =>
          ["bmw-panoramic", "ncap-hmi-2026"].includes(id),
        ),
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "AI assistants", exact: false })
      .click();
    await expect(
      page.getByRole("link", { name: "Bring to council" }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Cockpit usability", exact: false })
      .click();
    await expect(
      page.getByRole("link", { name: "Bring to council" }),
    ).toBeVisible();
    await page.screenshot({
      path: "/tmp/market-result.png",
      fullPage: true,
      animations: "disabled",
    });
    expect(debatePosts).toBe(0);
    await page.getByRole("link", { name: "Bring to council" }).click();
    await expect(
      page.getByRole("button", { name: "Start live debate" }),
    ).toBeEnabled();
    expect(debatePosts).toBe(0);
    await page.getByRole("button", { name: "Start live debate" }).click();
    await page.reload();
    await finish("bmw-live-debate-job", 950000);
    await expect(page.locator(".lc-turn")).toHaveCount(6);
    await expect(page.locator(".lc-market").last()).toContainText(
      "Responding to:",
    );
    await expect(page.locator(".lc-challenge")).not.toHaveCount(0);
    await page.screenshot({
      path: "/tmp/market-council.png",
      fullPage: true,
      animations: "disabled",
    });
    const saved = await page
      .getByRole("link", { name: "Link to this saved debate" })
      .getAttribute("href");
    console.log("SAVED DEBATE", saved);
    console.log(
      "MARKET JOB",
      await page.evaluate(() => localStorage.getItem("bmw-live-market-job")),
    );
    await page.goto(saved!);
    await expect(page.locator(".lc-turn")).toHaveCount(6);
    expect(debatePosts).toBe(1);
  }
  expect(errors).toEqual([]);
});
