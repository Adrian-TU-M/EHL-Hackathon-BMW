import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFileSync, mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import JSZip from "jszip";

async function start(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start Product Analysis", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm scope & begin" }).click();
  await page.getByRole("link", { name: "Presentations", exact: true }).click();
}

test("isolated studio: PM review, slides, variants, revision, exports and rehearsal", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await start(page);
  await page.getByRole("button", { name: "Load presentation demo" }).click();
  await expect(page.locator(".studio-context")).toContainText(
    "3 approved decisions",
  );
  await page
    .getByRole("button", { name: "Save brief & review outline" })
    .click();
  await expect(page.locator(".outline-list li")).toHaveCount(12);
  await page
    .getByRole("button", { name: "Approve outline", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Generate audience deck", exact: true })
    .click();
  await expect(page.locator(".slide-thumbnails button")).toHaveCount(15);
  await expect(page.locator(".slide-main .slide-canvas")).toContainText(
    "SYNTHETIC DEMO",
  );
  await expect(page.locator(".studio-error")).toHaveCount(0);
  await page.screenshot({
    path: "test-results/presentation-studio.png",
    fullPage: true,
    animations: "disabled",
  });

  await page.getByRole("button", { name: /Open slide 2:/ }).click();
  await page
    .getByLabel("Revision request", { exact: true })
    .fill("Make this clearer for Finance");
  await page
    .getByRole("button", { name: "Propose revision", exact: true })
    .click();
  await expect(page.locator(".revision-comparison")).toContainText(
    "Finance focus",
  );
  await expect(
    page.getByLabel("Slide takeaway", { exact: true }),
  ).not.toHaveValue(/Finance focus/);
  await page
    .getByRole("button", { name: "Apply proposed revision", exact: true })
    .click();
  await expect(page.getByLabel("Slide takeaway", { exact: true })).toHaveValue(
    /Finance focus/,
  );
  await page.getByRole("button", { name: "Lock slide", exact: true }).click();
  await expect(page.getByLabel("Slide title", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Unlock slide", exact: true }).click();
  await expect(page.getByLabel("Slide title", { exact: true })).toBeEnabled();

  await page
    .getByRole("button", { name: "Open voice assistant", exact: true })
    .click();
  await expect(
    page.getByText("Voice assistant is not configured", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: () =>
        Promise.reject(new DOMException("Denied", "NotAllowedError")),
    });
  });
  await page
    .getByRole("button", { name: "Test microphone", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Microphone unavailable",
  );
  await expect(page.locator(".voice-setup")).toContainText(
    "scripted demo revisions and coaching",
  );
  await page
    .locator(".voice-setup")
    .screenshot({ path: "test-results/presentation-voice-guide.png" });
  await page
    .getByRole("button", { name: "Close voice assistant", exact: true })
    .click();

  await page
    .getByLabel("Audience version", { exact: true })
    .selectOption("finance");
  await expect(
    page.getByRole("button", { name: "Generate audience deck", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Open outline", exact: true }).click();
  await expect(
    page.getByLabel("Department outline", { exact: true }),
  ).toHaveValue("finance");
  await page
    .getByRole("button", { name: "Approve outline", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Generate audience deck", exact: true })
    .click();
  await expect(page.locator(".slide-thumbnails button")).toHaveCount(15);
  await page
    .getByLabel("Review acknowledgment", { exact: true })
    .fill(
      "Reviewed the synthetic assumptions and remaining engineering and finance validation needs.",
    );
  await page
    .getByRole("button", {
      name: "Finalize presentation revision",
      exact: true,
    })
    .click();
  await expect(page.locator(".studio-context")).toContainText("PM FINALIZED");

  const pptxDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "PowerPoint", exact: true }).click();
  await (await pptxDownload).saveAs("test-results/presentation-finance.pptx");
  const zip = await JSZip.loadAsync(
    readFileSync("test-results/presentation-finance.pptx"),
  );
  expect(
    Object.keys(zip.files).filter((p) =>
      /^ppt\/slides\/slide\d+\.xml$/.test(p),
    ),
  ).toHaveLength(15);
  expect(
    Object.keys(zip.files).filter((p) => /^ppt\/charts\/chart\d+\.xml$/.test(p))
      .length,
  ).toBeGreaterThan(0);
  expect(
    Object.keys(zip.files).filter((p) =>
      /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(p),
    ),
  ).toHaveLength(15);
  const slide1 = await zip.file("ppt/slides/slide1.xml")!.async("string");
  expect(slide1).toContain("SYNTHETIC DEMO");
  expect(slide1).toContain("<a:t>");
  expect(slide1).not.toMatch(/PM FINALIZED|REVISION|PM approved/);
  const notes = await zip
    .file("ppt/notesSlides/notesSlide1.xml")!
    .async("string");
  expect(notes).toContain("SOURCE REFERENCES");
  expect(notes).toContain("Synthetic customer feedback");
  expect(
    Object.keys(zip.files).some((p) => /^ppt\/embeddings\/.*\.xlsx$/.test(p)),
  ).toBe(true);
  for (const name of Object.keys(zip.files).filter((p) =>
    /^ppt\/slides\/slide\d+\.xml$/.test(p),
  )) {
    const xml = await zip.file(name)!.async("string");
    expect(xml).toContain("SYNTHETIC DEMO");
    expect(xml).not.toMatch(
      /PM FINALIZED|PM rationale:|approved version|REVISION/,
    );
  }
  const exportedSlideNames = Object.keys(zip.files).filter((name) =>
    /^ppt\/slides\/slide\d+\.xml$/.test(name),
  );
  expect(
    (
      await Promise.all(
        exportedSlideNames.map((name) => zip.file(name)!.async("string")),
      )
    ).some((xml) => xml.includes("<a:tbl>")),
  ).toBe(true);
  const pdfDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF", exact: true }).click();
  await (await pdfDownload).saveAs("test-results/presentation-finance.pdf");
  expect(
    readFileSync("test-results/presentation-finance.pdf")
      .subarray(0, 4)
      .toString(),
  ).toBe("%PDF");

  await page.getByRole("button", { name: "Present", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("elapsed");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("button", { name: "Rehearse", exact: true }).click();
  await page
    .getByRole("button", { name: "Start rehearsal", exact: true })
    .click();
  for (let i = 0; i < 3; i++) {
    await page
      .getByLabel("Rehearsal answer", { exact: true })
      .fill(
        "We will validate adoption, incremental contribution, and engineering risk before releasing more funding.",
      );
    await page
      .getByRole("button", {
        name: "Review answer & next objection",
        exact: true,
      })
      .click();
    if (i < 2)
      await expect(
        page.getByLabel("Rehearsal answer", { exact: true }),
      ).toHaveValue("");
  }
  await expect(
    page.getByText("Rehearsal complete", { exact: true }),
  ).toBeVisible();
  const url = page.url();
  await page.reload();
  await expect(page.locator(".slide-thumbnails button")).toHaveCount(15);
  expect(page.url()).toBe(url);
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.locator(".studio-history")).toContainText(
    "PM applied a proposed revision",
  );
  await page.goto("/decisions?demo=1");
  await expect(
    page.getByRole("button", { name: "Create presentation", exact: true }),
  ).toBeDisabled();
  expect(errors).toEqual([]);
});

test("dashboard approvals and reopened requirements mark the frozen presentation stale", async ({
  page,
}) => {
  await start(page);
  await page.goto("/decisions?demo=1");
  const first = page.locator(".requirement-card").first();
  await first.getByRole("button", { name: "Review", exact: true }).click();
  await page
    .getByLabel("Your decision", { exact: true })
    .selectOption("Approved");
  await page
    .getByLabel("Decision rationale", { exact: false })
    .fill("Approve a bounded pilot for this need.");
  await page
    .getByRole("button", { name: "Record decision", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create presentation", exact: true })
    .click();
  await expect(page.locator(".studio-context")).toContainText(
    "1 approved decisions",
  );
  const deckUrl = page.url();
  await page.goto("/decisions?demo=1");
  await first.getByRole("button", { name: "Revisit", exact: true }).click();
  await page
    .getByLabel("Your decision", { exact: true })
    .selectOption("Pending review");
  await page
    .getByLabel("Decision rationale", { exact: false })
    .fill("Reopen for evidence review.");
  await page
    .getByRole("button", { name: "Record decision", exact: true })
    .click();
  await page.goto(deckUrl);
  await expect(
    page.getByText("Approved inputs changed. This deck needs review.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Outline", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Approve outline", exact: true }),
  ).toBeDisabled();
});

test("presentation studio fits a phone and exposes backend failures", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start Product Analysis", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm scope & begin" }).click();
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await page.getByRole("link", { name: "Presentations", exact: true }).click();
  await page.getByRole("button", { name: "Load presentation demo" }).click();
  await page
    .getByRole("button", { name: "Save brief & review outline" })
    .click();
  await page
    .getByRole("button", { name: "Approve outline", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Generate audience deck", exact: true })
    .click();
  await expect(page.locator(".slide-thumbnails button")).toHaveCount(15);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/presentation-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.route("**/api/presentations*", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
  );
  await page
    .getByRole("button", { name: "All presentations", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Presentation service unavailable",
  );
});

test("four department stories share the BMW theme and export clean editable slides", async ({
  page,
}) => {
  test.setTimeout(120000);
  await start(page);
  await page
    .getByRole("button", { name: "Load presentation demo", exact: true })
    .click();
  await page
    .getByLabel("Presenter name (optional)", { exact: true })
    .fill("Alex Morgan");
  await page
    .getByLabel("Presenter role (optional)", { exact: true })
    .fill("Product Manager");
  await page
    .getByLabel("Meeting date (optional)", { exact: true })
    .fill("2026-10-10");
  await page
    .getByRole("button", { name: "Save brief & review outline", exact: true })
    .click();
  const orders: string[][] = [];
  const output = "output/presentations/bmw-cinematic-v1";
  mkdirSync(output, { recursive: true });
  for (const audience of ["executive", "finance", "engineering", "sales"]) {
    await page.getByRole("button", { name: "Outline", exact: true }).click();
    await page
      .getByLabel("Department outline", { exact: true })
      .selectOption(audience);
    const sections = await page
      .locator(".outline-section-label input")
      .evaluateAll((nodes) => nodes.map((n) => (n as HTMLInputElement).value));
    expect(new Set(sections).size).toBe(3);
    orders.push(
      await page
        .locator('.outline-list input[aria-label$="outline title"]')
        .evaluateAll((nodes) =>
          nodes.map((n) => (n as HTMLInputElement).value),
        ),
    );
    await page
      .getByRole("button", { name: "Approve outline", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Generate audience deck", exact: true })
      .click();
    await expect(page.locator(".slide-thumbnails button")).toHaveCount(15);
    await expect(page.locator(".studio-error")).toHaveCount(0);
    await expect(page.locator(".studio-theme-status")).toContainText(
      "Cinematic Automotive",
    );
    await expect(page.locator(".slide-main .slide-canvas")).toContainText(
      "Alex Morgan",
    );
    await page
      .locator(".slide-main .slide-canvas")
      .screenshot({ path: `test-results/premium-${audience}-cover.png` });
    const pdf = page.waitForEvent("download");
    await page.getByRole("button", { name: "PDF", exact: true }).click();
    await (await pdf).saveAs(`test-results/premium-${audience}.pdf`);
    const pptx = page.waitForEvent("download");
    await page.getByRole("button", { name: "PowerPoint", exact: true }).click();
    await (await pptx).saveAs(`test-results/premium-${audience}.pptx`);
    copyFileSync(
      `test-results/premium-${audience}.pptx`,
      `${output}/${audience}.pptx`,
    );
    copyFileSync(
      `test-results/premium-${audience}.pdf`,
      `${output}/${audience}.pdf`,
    );
    if (audience === "executive") {
      for (const format of ["pptx", "pdf"] as const) {
        const download = page.waitForEvent("download");
        await page.evaluate(
          async ({ format }) => {
            const id = location.pathname.split("/").at(-1);
            const p = await (await fetch(`/api/presentations/${id}`)).json();
            const modulePath = "/src/lib/presentation/export.ts";
            const { exportPresentation } = await import(
              /* @vite-ignore */ modulePath
            );
            await exportPresentation(p, "executive", format, {
              reference: true,
            });
          },
          { format },
        );
        await (await download).saveAs(`${output}/reference.${format}`);
      }
    }
    const zip = await JSZip.loadAsync(
      readFileSync(`test-results/premium-${audience}.pptx`),
    );
    const slideNames = Object.keys(zip.files).filter((p) =>
      /^ppt\/slides\/slide\d+\.xml$/.test(p),
    );
    expect(slideNames).toHaveLength(15);
    for (const name of slideNames) {
      const xml = await zip.file(name)!.async("string");
      expect(xml).toContain("SYNTHETIC DEMO");
      expect(xml).not.toMatch(
        /PM FINALIZED|REVISION|PM rationale:|approved version/i,
      );
    }
    expect(
      Object.keys(zip.files).some((p) =>
        /^ppt\/charts\/chart\d+\.xml$/.test(p),
      ),
    ).toBe(true);
    expect(
      Object.keys(zip.files).some((p) => /^ppt\/embeddings\/.*\.xlsx$/.test(p)),
    ).toBe(true);
  }
  expect(new Set(orders.map((o) => o.join("|"))).size).toBe(4);
  const id = page.url().split("/").at(-1);
  const p = await (await page.request.get(`/api/presentations/${id}`)).json();
  writeFileSync(`${output}/demo-workspace.json`, JSON.stringify(p, null, 2));
});

test("BMW preview is read-only and theme application preserves locked PM content", async ({
  page,
}) => {
  await start(page);
  await page
    .getByRole("button", { name: "Load presentation demo", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save brief & review outline", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Approve outline", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Generate audience deck", exact: true })
    .click();
  await expect(page.locator(".slide-thumbnails button")).toHaveCount(15);
  await page.getByRole("button", { name: /Open slide 2:/ }).click();
  await page
    .getByLabel("Observed friction 1", { exact: true })
    .fill("Test the customer need before scaling");
  await page
    .getByRole("button", { name: "Save slide changes", exact: true })
    .click();
  await expect(page.locator(".slide-main .slide-canvas")).toContainText(
    /Test the customer need before\s*scaling/,
  );
  await page.getByRole("button", { name: "Lock slide", exact: true }).click();
  const id = page.url().split("/").at(-1);
  let p = await (await page.request.get(`/api/presentations/${id}`)).json();
  await page.request.post(`/api/presentations/${id}/theme`, {
    data: {
      audience: "executive",
      expected_revision: p.revision,
      theme_id: "premium-v1",
    },
  });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Preview BMW theme", exact: true }),
  ).toBeVisible();
  p = await (await page.request.get(`/api/presentations/${id}`)).json();
  await page
    .getByRole("button", { name: "Preview BMW theme", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Preview only");
  const unchanged = await (
    await page.request.get(`/api/presentations/${id}`)
  ).json();
  expect(unchanged.revision).toBe(p.revision);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Apply BMW theme", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".studio-theme-status")).toContainText(
    "Cinematic Automotive",
  );
  const after = await (
    await page.request.get(`/api/presentations/${id}`)
  ).json();
  expect(after.revision).toBe(p.revision + 1);
  expect(after.decks.executive.slides).toEqual(p.decks.executive.slides);
  expect(after.snapshot).toEqual(p.snapshot);
  expect(after.history.at(-1).decks.executive.theme_id).toBe("premium-v1");
});
