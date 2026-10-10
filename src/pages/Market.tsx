import { useState } from "react";
import {
  Area,
  ComposedChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { ArrowUpRight, Globe2, Info, TrendingUp } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { marketSeries } from "../lib/mock-data";
import { Badge, PageHeader, SectionTitle } from "../components/ui/Primitives";
import { EvidenceDialog } from "../components/dashboard/EvidenceDialog";
import type { Market as MarketType } from "../lib/types";
const colors = {
  Europe: "#1c69d4",
  "United States": "#58b2ba",
  China: "#98a7bf",
};
export default function Market() {
  const { scope, evidence } = useAppStore();
  const [selected, setSelected] = useState<MarketType>(scope.market);
  const [sensitivity, setSensitivity] = useState(0);
  const [ids, setIds] = useState<string[] | null>(null);
  const [compare, setCompare] = useState(true);
  const data = marketSeries.map((r, i) => ({
    ...r,
    historical: i <= 1 ? r[selected] : null,
    projection:
      i >= 1
        ? Math.round(
            r[selected] * (1 + ((sensitivity / 100) * Math.max(0, i - 1)) / 5),
          )
        : null,
  }));
  const signals = evidence.filter((e) => e.domain === "market");
  return (
    <>
      <PageHeader
        eyebrow="02 / THE FUTURE PERSPECTIVE"
        title="Understand the direction."
        description="Separate what is known from what the future might hold."
      />
      <div className="market-banner">
        <Globe2 size={27} />
        <div>
          <span className="eyebrow">YOUR PLANNING CONTEXT</span>
          <h2>
            {scope.market} <span>/</span> {2026 + scope.horizon}
          </h2>
        </div>
        <p>
          A {scope.horizon}-year view of changing expectations.
          <br />
          <strong>Scenario exploration, not a sales forecast.</strong>
        </p>
        <Badge tone="blue">ILLUSTRATIVE OUTLOOK</Badge>
      </div>
      <section className="panel panel-padding">
        <SectionTitle
          title="Different markets. Different trajectories."
          detail="Illustrative demand index · arbitrary demo units, not actual sales volumes"
          action={
            <div className="segmented">
              {(["Europe", "United States", "China"] as MarketType[]).map(
                (m) => (
                  <button
                    key={m}
                    className={m === selected ? "active" : ""}
                    onClick={() => setSelected(m)}
                  >
                    {m}
                  </button>
                ),
              )}
            </div>
          }
        />
        <div className="market-chart">
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart
              data={data}
              margin={{ top: 25, right: 30, left: -15, bottom: 5 }}
            >
              <defs>
                <linearGradient id="market-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#1c69d4" stopOpacity={0.17} />
                  <stop offset="100%" stopColor="#1c69d4" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 5"
                stroke="#e8ecf1"
                vertical={false}
              />
              <XAxis
                dataKey="year"
                axisLine={false}
                tickLine={false}
                tickMargin={15}
                fontSize={12}
              />
              <YAxis
                domain={[40, 180]}
                axisLine={false}
                tickLine={false}
                fontSize={11}
              />
              <Tooltip />
              <ReferenceLine
                x="2025"
                stroke="#aab5c6"
                strokeDasharray="4 4"
                label={{
                  value: "FUTURE ASSUMPTIONS →",
                  position: "insideTopRight",
                  fontSize: 10,
                  fill: "#69798c",
                }}
              />
              {compare &&
                Object.keys(colors)
                  .filter((m) => m !== selected)
                  .map((m) => (
                    <Line
                      key={m}
                      dataKey={m}
                      stroke={colors[m as MarketType]}
                      strokeWidth={1.5}
                      strokeDasharray="3 5"
                      dot={false}
                    />
                  ))}
              <Area
                dataKey="projection"
                name={`${selected} · scenario`}
                stroke="#1c69d4"
                strokeWidth={3}
                strokeDasharray="6 5"
                fill="url(#market-fill)"
                dot={{ r: 3 }}
              />
              <Line
                dataKey="historical"
                name={`${selected} · historical demo`}
                stroke="#1c69d4"
                strokeWidth={3}
                dot={{ r: 4 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="chart-controls">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={compare}
              onChange={(e) => setCompare(e.target.checked)}
            />{" "}
            Compare regions
          </label>
          <div className="legend-inline">
            <span>
              <i />
              Historical demo
            </span>
            <span>
              <i className="dashed" />
              Future assumption
            </span>
          </div>
          <span className="mono small">SOURCE / SYNTHETIC SERIES</span>
        </div>
        <div className="scenario-adjustment">
          <div>
            <strong>Explore a different assumption</strong>
            <p>
              Adjust the selected region’s 2030 endpoint. Intermediate values
              scale linearly.
            </p>
          </div>
          <label>
            <span>
              Endpoint sensitivity{" "}
              <strong>
                {sensitivity > 0 ? "+" : ""}
                {sensitivity}%
              </strong>
            </span>
            <input
              aria-label="Future demand sensitivity"
              type="range"
              min="-25"
              max="25"
              step="5"
              value={sensitivity}
              onChange={(e) => setSensitivity(Number(e.target.value))}
            />
          </label>
        </div>
        <p className="chart-note">
          2024–2025 values are synthetic historical examples; 2026–2029 values
          are assumptions and 2030 is an illustrative future figure. None is
          extracted from sales_volumes.xlsx. Real supplied 2030 figures must
          remain distinct from observed sales.
        </p>
      </section>
      <div className="section-spacer">
        <SectionTitle
          title="Signals worth exploring"
          detail="Hypotheses to validate before they shape a product decision."
        />
      </div>
      <div className="signal-grid">
        {signals.slice(0, 3).map((e, i) => (
          <button
            key={e.id}
            className="panel signal-card"
            onClick={() => setIds([e.id])}
          >
            <span className="signal-icon">
              {i === 0 ? (
                <TrendingUp size={22} />
              ) : i === 1 ? (
                <Globe2 size={22} />
              ) : (
                <Info size={22} />
              )}
            </span>
            <Badge>ASSUMPTION</Badge>
            <h3>
              {e.category === "Displays"
                ? "Intuitive digital experiences"
                : e.category === "Charging"
                  ? "Confidence in electric journeys"
                  : "Comfort across the cabin"}
            </h3>
            <p>{e.passage}</p>
            <div className="flex-between">
              <span className="small muted">{e.publishedAt} · Demo source</span>
              <ArrowUpRight size={18} />
            </div>
          </button>
        ))}
      </div>
      <div className="notice section-spacer">
        <Info size={18} />
        <p>
          The direction and magnitude of these curves are assumptions. They
          cannot establish customer demand, sales uplift or ROI. Import the real
          sales file and dated external research to test them.
        </p>
      </div>
      {ids && <EvidenceDialog ids={ids} onClose={() => setIds(null)} />}
    </>
  );
}
