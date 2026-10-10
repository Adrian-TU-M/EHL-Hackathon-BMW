import { useMemo, useState } from "react";
import {
  Search,
  ArrowUpRight,
  Users,
  Heart,
  MessageSquare,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { studyRows } from "../lib/mock-data/studies";
import type { Market } from "../lib/types";
import { useAppStore } from "../store/useAppStore";
import {
  Badge,
  PageHeader,
  SectionTitle,
  Stat,
  EmptyState,
} from "../components/ui/Primitives";
import { EvidenceDialog } from "../components/dashboard/EvidenceDialog";
export default function Customer() {
  const { scope, evidence } = useAppStore();
  const [query, setQuery] = useState("");
  const [type, setType] = useState("All feedback");
  const [category, setCategory] = useState("All categories");
  const [ids, setIds] = useState<string[] | null>(null);
  const [region, setRegion] = useState(scope.market as string);
  const [vehicle, setVehicle] = useState(scope.vehicle as string);
  const [powertrain, setPowertrain] = useState(scope.powertrain as string);
  const customer = evidence.filter(
    (e) => e.domain === "customer" && e.type !== "Signal" && !e.exclusionReason,
  );
  const filtered = customer.filter(
    (e) =>
      e.vehicle === vehicle &&
      e.market === region &&
      e.powertrain === powertrain &&
      (type === "All feedback" || e.type === type) &&
      (category === "All categories" || e.category === category) &&
      `${e.passage} ${e.id} ${e.category}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const themes = useMemo(
    () =>
      [...new Set(customer.map((e) => e.category))]
        .map((name) => ({
          name,
          count: filtered.filter(
            (e) => e.category === name && e.type !== "Positive",
          ).length,
        }))
        .sort((a, b) => b.count - a.count),
    [customer, filtered],
  );
  const breakdown = ["Complaint", "Request", "Positive"].map((name, i) => ({
    name,
    value: filtered.filter((e) => e.type === name).length,
    color: ["#1c69d4", "#80b7f9", "#bdd6ef"][i],
  }));
  return (
    <>
      <PageHeader
        eyebrow="01 / THE HUMAN PERSPECTIVE"
        title="Listen closer. See further."
        description="Connect customer voices to the experiences that matter."
      />
      <div className="stat-grid three">
        <Stat
          label="Feedback records"
          value={filtered.length}
          detail="Distinct synthetic records after filters"
        />
        <Stat
          label="Improvement signals"
          value={filtered.filter((e) => e.type !== "Positive").length}
          detail="Complaints and requested features"
        />
        <Stat
          label="Qualities to preserve"
          value={filtered.filter((e) => e.type === "Positive").length}
          detail="Positive experiences in the fixtures"
        />
      </div>
      <div className="filter-bar">
        <div className="search-field">
          <Search size={16} />
          <input
            aria-label="Search customer evidence"
            placeholder="Search the customer voice…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          aria-label="Filter vehicle"
          value={vehicle}
          onChange={(e) => setVehicle(e.target.value)}
        >
          {["F70", "G60", "G70"].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <select
          aria-label="Filter region"
          value={region}
          onChange={(e) => setRegion(e.target.value)}
        >
          {["Europe", "United States", "China"].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <select
          aria-label="Filter powertrain"
          value={powertrain}
          onChange={(e) => setPowertrain(e.target.value)}
        >
          {["Electric", "Plug-in hybrid", "Combustion"].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <select
          aria-label="Feedback type"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          {["All feedback", "Complaint", "Request", "Positive"].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <select
          aria-label="Feedback category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {["All categories", ...new Set(customer.map((e) => e.category))].map(
            (v) => (
              <option key={v}>{v}</option>
            ),
          )}
        </select>
      </div>
      <div className="analytics-grid">
        <section className="panel panel-padding">
          <SectionTitle
            title="Where friction appears"
            detail="Complaint + request records by theme"
            action={<Badge>DEMO COUNTS</Badge>}
          />
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={themes}
                layout="vertical"
                margin={{ left: 5, right: 30 }}
              >
                <CartesianGrid
                  strokeDasharray="3 5"
                  horizontal={false}
                  stroke="#e9edf2"
                />
                <XAxis
                  type="number"
                  allowDecimals={false}
                  fontSize={11}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  dataKey="name"
                  type="category"
                  width={106}
                  fontSize={12}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip cursor={{ fill: "#243c59" }} />
                <Bar
                  dataKey="count"
                  name="Synthetic records"
                  fill="#1c69d4"
                  radius={[0, 3, 3, 0]}
                  maxBarSize={19}
                  onClick={(d) => setCategory(String(d.name))}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="chart-note">
            Count of filtered fixture records; denominator {filtered.length}.
            Each fixture appears once. These are not population-level
            preferences.
          </p>
        </section>
        <section className="panel panel-padding">
          <SectionTitle
            title="The balance of feedback"
            detail="Preserve what works. Improve what doesn’t."
          />
          <div className="donut-wrap">
            <ResponsiveContainer width="100%" height={215}>
              <PieChart>
                <Pie
                  data={breakdown}
                  dataKey="value"
                  innerRadius={65}
                  outerRadius={87}
                  paddingAngle={4}
                  stroke="none"
                >
                  {breakdown.map((d) => (
                    <Cell key={d.name} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="donut-center">
              <strong>{filtered.length}</strong>
              <span>RECORDS</span>
            </div>
          </div>
          <div className="chart-legend">
            {breakdown.map((d) => (
              <button key={d.name} onClick={() => setType(d.name)}>
                <i style={{ background: d.color }} />
                {d.name}
                <strong>{d.value}</strong>
              </button>
            ))}
          </div>
        </section>
      </div>
      <section className="panel panel-padding section-spacer">
        <SectionTitle
          title="Satisfaction, in context"
          detail="Arithmetic means from eight invented ratings per category and region. Click a bar to inspect every input."
          action={<Badge>ILLUSTRATIVE STUDY</Badge>}
        />
        <div className="study-grid">
          <div>
            <ResponsiveContainer width="100%" height={235}>
              <BarChart
                data={studyRows(region as Market)}
                margin={{ top: 12, right: 15, bottom: 5, left: -25 }}
              >
                <CartesianGrid
                  strokeDasharray="3 5"
                  stroke="#e8edf3"
                  vertical={false}
                />
                <XAxis
                  dataKey="category"
                  axisLine={false}
                  tickLine={false}
                  fontSize={11}
                />
                <YAxis
                  domain={[0, 5]}
                  axisLine={false}
                  tickLine={false}
                  fontSize={10}
                />
                <Tooltip formatter={(v) => [`${v} / 5`, "Synthetic mean"]} />
                <Bar
                  dataKey="mean"
                  fill="#1c69d4"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={44}
                  onClick={(d) => setIds([String(d.id)])}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="study-regions">
            <h3>A regional comparison</h3>
            <p>Selected vehicle / displays satisfaction</p>
            {(["Europe", "United States", "China"] as Market[]).map((m) => (
              <button key={m} onClick={() => setIds([studyRows(m)[0].id])}>
                <span>{m}</span>
                <div>
                  <i
                    style={{ width: `${(studyRows(m)[0].mean / 5) * 100}%` }}
                  />
                </div>
                <strong>{studyRows(m)[0].mean.toFixed(2)}</strong>
                <ArrowUpRight size={14} />
              </button>
            ))}
            <small>
              Each regional mean uses a separate set of eight invented ratings.
              These differences have no statistical significance.
            </small>
          </div>
        </div>
        <p className="chart-note">
          Source: Synthetic satisfaction-study examples · September 2026 ·
          current analysis vehicle and powertrain. Study examples are separate
          from feedback search filters; the region filter selects the left
          chart.
        </p>
      </section>
      <div className="insight-strip">
        <Users size={22} />
        <div>
          <strong>What’s missing matters, too.</strong>
          <p>
            Real satisfaction patterns and regional differences need the
            supplied study. Feedback fixtures cover {scope.vehicle},{" "}
            {scope.market}, {scope.powertrain}. Synthetic study examples
            illustrate comparisons, without supporting a real cross-region
            conclusion.
          </p>
        </div>
        <Badge tone="amber">STUDY NOT CONNECTED</Badge>
      </div>
      <section className="panel panel-padding">
        <SectionTitle
          title="The voices behind the signals"
          detail={`${filtered.length} source records · open any passage to inspect provenance`}
          action={<Badge tone="blue">SOURCE EXPLORER</Badge>}
        />
        {filtered.length ? (
          <div className="evidence-cards">
            {filtered.map((e) => (
              <button
                className="evidence-card"
                key={e.id}
                onClick={() => setIds([e.id])}
              >
                <div className="flex-between">
                  <Badge tone={e.type === "Positive" ? "green" : "blue"}>
                    {e.type === "Positive" ? (
                      <Heart size={12} />
                    ) : (
                      <MessageSquare size={12} />
                    )}{" "}
                    {e.type}
                  </Badge>
                  <ArrowUpRight size={16} />
                </div>
                <blockquote>“{e.passage}”</blockquote>
                <div className="evidence-card-bottom">
                  <span>{e.category}</span>
                  <span>{e.id} · DEMO</span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No matching evidence"
            detail="Try a different filter. Other contexts require a new analysis or a real data integration."
          />
        )}
      </section>
      {ids && <EvidenceDialog ids={ids} onClose={() => setIds(null)} />}
    </>
  );
}
