import { describe, expect, it } from "vitest";
import { demoCustomerSource, demoFeatures } from "../src/lib/api/customerDemo";
import { MARKET_OPTIONS, POWERTRAIN_OPTIONS } from "../src/lib/api/customer";

const f = { vehicle: "G60", market: "Europe", powertrain: "Electric", source: "All", category: "All" };
const descending = (xs: number[]) => xs.every((x, i) => i === 0 || xs[i - 1] >= x);

describe("Customer feature rankings (demo fallback)", () => {
  it("is always flagged as demo data", () => {
    const d = demoFeatures(f);
    expect(d.dataSource).toBe("demo");
    expect(d.coverage.warnings.join(" ")).toMatch(/DEMO/);
  });

  it("ranks most-mentioned features first on both sides", () => {
    const d = demoFeatures({ ...f, market: "All", powertrain: "All" });
    expect(d.dislikes.length).toBeGreaterThan(0);
    expect(d.likes.length).toBeGreaterThan(0);
    expect(descending(d.dislikes.map((r) => r.records))).toBe(true);
    expect(descending(d.likes.map((r) => r.records))).toBe(true);
  });

  it("splits dislikes from wants/likes and keeps counts consistent", () => {
    const d = demoFeatures(f);
    for (const r of d.dislikes) expect(Object.keys(r.byType)).toEqual(["Difficult to Use"]);
    for (const r of d.likes) {
      expect(Object.keys(r.byType).every((t) => t === "Likes" || t === "Wants")).toBe(true);
      expect(Object.values(r.byType).reduce((a, b) => a + b, 0)).toBe(r.records);
    }
    const total = [...d.dislikes, ...d.likes].reduce((a, r) => a + r.records, 0);
    expect(total).toBe(d.records);
  });

  it("shows no data, not zero-filled rows, for markets without fixtures", () => {
    const d = demoFeatures({ ...f, market: "Japan" });
    expect(d.records).toBe(0);
    expect(d.dislikes).toEqual([]);
    expect(d.likes).toEqual([]);
  });

  it("drills into one feature and type", async () => {
    const dd = await demoCustomerSource.drilldown({ ...f, category: "Seats" }, { type: "Likes" });
    expect(dd.quotes.items.length).toBeGreaterThan(0);
    expect(dd.quotes.items.every((e) => e.category === "Seats" && e.feedbackTypes.includes("Likes"))).toBe(true);
  });

  it("maps UI labels to backend values", () => {
    expect(MARKET_OPTIONS.find((m) => m.label === "US")?.value).toBe("United States");
    expect(POWERTRAIN_OPTIONS.find((p) => p.label === "BEV")?.value).toBe("Electric");
  });
});
