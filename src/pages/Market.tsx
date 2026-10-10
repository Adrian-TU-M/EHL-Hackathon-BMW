import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowRight,
  ArrowUpRight,
  BatteryCharging,
  ChevronDown,
  Cpu,
  Globe2,
  LoaderCircle,
  RefreshCw,
  Zap,
} from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import {
  api,
  LiveApiError,
  post,
  type Analysis,
  type Job,
  type Runtime,
  type Source,
} from "../lib/api/live";
import { useLiveJob } from "../lib/api/useLiveJob";
import type {
  MarketDashboard,
  MarketTopic,
  SourceCheck,
} from "../lib/api/market";
import "./market.css";
const topics: { name: MarketTopic; icon: typeof Zap }[] = [
  { name: "Feature trends", icon: Cpu },
  { name: "Electrification", icon: Zap },
  { name: "Charging", icon: BatteryCharging },
  { name: "Digital experience", icon: Cpu },
  { name: "Regional demand", icon: Globe2 },
];
const regions = ["Europe", "United States", "China"] as const;
function SourceDetails({
  source,
  check,
}: {
  source?: Source;
  check?: SourceCheck;
}) {
  if (!source) return null;
  return (
    <details className="mt-source">
      <summary>
        {source.brand} ·{" "}
        {source.source_type === "customer_study"
          ? source.model + " study"
          : source.locator}{" "}
        <ChevronDown size={14} />
      </summary>
      <div>
        <strong>{source.source_title}</strong>
        <p>{source.passage}</p>
        <p>{source.locator}</p>
        <p className="mt-review-date">
          {source.published_on ? `Published ${source.published_on} · ` : ""}
          {source.verified_on
            ? `Reviewed ${source.verified_on} · Review due ${source.review_due_on}`
            : "Imported dataset · source limitations below"}
        </p>
        {check && (
          <p className="mt-review-date">
            Page check {new Date(check.checked_at).toLocaleString()}:{" "}
            {check.detail}
          </p>
        )}
        {source.source_uri.startsWith("https://") && (
          <a href={source.source_uri} target="_blank" rel="noreferrer">
            Read original source <ArrowUpRight size={13} />
          </a>
        )}
        <ul>
          {source.caveats.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
    </details>
  );
}
function savedSelection() {
  try {
    const p = JSON.parse(
      localStorage.getItem("bmw-market-selection-v1") || "{}",
    );
    return {
      region: regions.includes(p.region) ? p.region : undefined,
      topic: topics.some((t) => t.name === p.topic) ? p.topic : undefined,
      feature: typeof p.feature === "string" ? p.feature : "cockpit",
    };
  } catch {
    return {};
  }
}
export default function Market() {
  const scope = useAppStore((s) => s.scope);
  const [region, setRegion] = useState<string>(
    () => savedSelection().region || scope.market,
  );
  const [topic, setTopic] = useState<MarketTopic>(
    () => savedSelection().topic || "Feature trends",
  );
  const [signalIndex, setSignalIndex] = useState(0);
  const [featureId, setFeatureId] = useState(
    () => savedSelection().feature || "cockpit",
  );
  const [checkingSources, setCheckingSources] = useState(false);
  const [checkError, setCheckError] = useState("");
  const [resultTab, setResultTab] = useState<
    "Benefit" | "Trade-off" | "Validate"
  >("Validate");
  const [data, setData] = useState<MarketDashboard | null>(null);
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [error, setError] = useState("");
  const [requestError, setRequestError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [chartLevel, setChartLevel] = useState<"group" | "model">("group");
  const [submitting, setSubmitting] = useState(false);
  const chartId = useId().replaceAll(":", "");
  const {
    job,
    busy,
    error: pollError,
    reserve,
    attach,
    discard,
  } = useLiveJob<Analysis>("bmw-live-market-job");
  useEffect(() => {
    try {
      localStorage.setItem(
        "bmw-market-selection-v1",
        JSON.stringify({ region, topic, feature: featureId }),
      );
    } catch {
      /* Optional storage */
    }
  }, [region, topic, featureId]);
  useEffect(() => {
    const abort = new AbortController();
    setError("");
    setData(null);
    setSignalIndex(0);
    const params = new URLSearchParams({
      vehicle: scope.vehicle,
      market: region,
      powertrain: scope.powertrain,
    });
    Promise.all([
      api<MarketDashboard>(`/market/dashboard?${params}`, {
        signal: abort.signal,
      }),
      api<Runtime>("/market/status", { signal: abort.signal }),
    ])
      .then(([d, r]) => {
        if (!abort.signal.aborted) {
          setData(d);
          setRuntime(r);
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [region, scope.vehicle, scope.powertrain, refresh]);
  const source = (id?: string) => data?.evidence.find((e) => e.id === id);
  const signals = data?.signals.filter((s) => s.topic === topic) || [];
  const signal =
    signals[Math.min(signalIndex, Math.max(0, signals.length - 1))];
  const feature =
    topic === "Feature trends"
      ? data?.features.find((f) => f.id === featureId) || data?.features[0]
      : undefined;
  const group = data?.series.find((s) => s.level === "group");
  const model = data?.series.find((s) => s.level === "model");
  const series = chartLevel === "group" ? group : model;
  const points = series?.points.filter((p) => p.kind !== "planning") || [];
  const planning = model?.points.find((p) => p.kind === "planning");
  const yoy = group?.yoy;
  const result =
    job?.status === "succeeded" && job.kind === "market_analysis"
      ? job.result
      : null;
  const matches =
    result &&
    result.scope.market === region &&
    result.scope.vehicle === scope.vehicle &&
    result.scope.powertrain === scope.powertrain &&
    result.scope.horizon === scope.horizon &&
    result.market_topic === topic &&
    (result.feature_id || null) === (feature?.id || null);
  const rec = matches ? result.recommendations[0] : null;
  async function checkSources() {
    if (!feature || checkingSources) return;
    setCheckingSources(true);
    setCheckError("");
    try {
      const checks = await post<Record<string, SourceCheck>>(
        `/market/sources/check?feature_id=${encodeURIComponent(feature.id)}`,
        {},
      );
      setData((current) =>
        current
          ? {
              ...current,
              source_checks: { ...current.source_checks, ...checks },
            }
          : current,
      );
    } catch (e) {
      setCheckError(e instanceof Error ? e.message : "Source check failed.");
    } finally {
      setCheckingSources(false);
    }
  }
  const failedHere =
    job?.status === "failed" &&
    job.kind === "market_analysis" &&
    job.request.scope.market === region &&
    job.request.scope.vehicle === scope.vehicle &&
    job.request.scope.powertrain === scope.powertrain &&
    job.request.scope.horizon === scope.horizon &&
    job.request.market_topic === topic &&
    (job.request.feature_id || null) === (feature?.id || null);
  async function retryAnalysis() {
    if (!job || !failedHere || busy || submitting) return;
    setSubmitting(true);
    setRequestError("");
    try {
      attach(await post<Job<Analysis>>(`/market/jobs/${job.id}/retry`, {}));
    } catch (e) {
      setRequestError(
        e instanceof Error ? e.message : "Retry could not start.",
      );
    } finally {
      setSubmitting(false);
    }
  }
  async function analyze() {
    if (submitting || busy) return;
    setSubmitting(true);
    setRequestError("");
    const id = reserve();
    try {
      attach(
        await post<Job<Analysis>>("/market/jobs", {
          client_job_id: id,
          analysis_id: crypto.randomUUID(),
          scope: {
            vehicle: scope.vehicle,
            market: region,
            powertrain: scope.powertrain,
            horizon: scope.horizon,
            topic: feature
              ? feature.feedback_query
              : topic === "Digital experience"
                ? "Displays"
                : topic === "Regional demand"
                  ? "Market priorities"
                  : topic,
          },
          market_topic: topic,
          feature_id: feature?.id || null,
        }),
      );
    } catch (e) {
      if (e instanceof LiveApiError && [409, 422, 503].includes(e.status))
        discard();
      setRequestError(
        e instanceof Error ? e.message : "Analysis could not start.",
      );
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <div className="mt-page">
      <header className="mt-heading">
        <div>
          <h1>
            Market trends<span>.</span>
          </h1>
        </div>
        <div className="mt-runtime">
          <span>
            <i className={runtime?.analysis_ready ? "ready" : ""} />
            {runtime?.model || "Connecting to agent"}
          </span>
          <small>Reviewed {data?.as_of || "…"}</small>
        </div>
      </header>
      <div className="mt-workspace">
        <div className="mt-controls">
          <div className="mt-region-tabs" aria-label="Choose market">
            {regions.map((r) => (
              <button
                key={r}
                aria-pressed={region === r}
                onClick={() => setRegion(r)}
              >
                {r}
              </button>
            ))}
          </div>
          <div className="mt-scope">
            BMW {scope.vehicle}
            <span>{scope.powertrain}</span>
            <button
              className="mt-refresh"
              aria-label="Refresh market data"
              title="Reload the reviewed evidence catalog"
              onClick={() => setRefresh((n) => n + 1)}
            >
              <RefreshCw size={15} />
            </button>
          </div>
        </div>
        <nav className="mt-topics" aria-label="Choose trend">
          {topics.map(({ name }) => (
            <button
              key={name}
              aria-pressed={topic === name}
              onClick={() => {
                setTopic(name);
                setSignalIndex(0);
              }}
            >
              {name}
            </button>
          ))}
        </nav>
        {error && (
          <div className="mt-error" role="alert">
            {error}
            <button onClick={() => setRefresh((n) => n + 1)}>Try again</button>
          </div>
        )}
        {!error && !data && (
          <div className="mt-loading" role="status">
            <LoaderCircle className="mt-spin" size={20} />
            Loading market evidence…
          </div>
        )}
        {data && (
          <>
            {topic === "Feature trends" && (
              <div className="mt-feature-nav" aria-label="Feature watchlist">
                <div className="mt-feature-intro">
                  <span>FEATURE WATCHLIST</span>
                  <small>
                    Documented developments · demand still to validate
                  </small>
                </div>
                <div className="mt-feature-options">
                  {data.features.map((f, i) => (
                    <button
                      key={f.id}
                      aria-pressed={feature?.id === f.id}
                      onClick={() => setFeatureId(f.id)}
                    >
                      <span>{String(i + 1).padStart(2, "0")}</span>
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-main">
              <section
                className="mt-signal-card"
                key={`${topic}-${region}-${signalIndex}-${feature?.id}`}
              >
                <div className="mt-laser-art" aria-hidden="true">
                  <i className="mt-laser" />
                  <i className="mt-laser mt-laser-secondary" />
                  <div className="mt-laser-haze" />
                </div>
                {feature ? (
                  <>
                    <div className="mt-signal-heading">
                      <span className="mt-eyebrow">
                        01 / THE FEATURE DIRECTION
                      </span>
                      <span className="mt-type">
                        {feature.examples.length} source signals
                      </span>
                    </div>
                    <h2 className="mt-feature-title">{feature.title}</h2>
                    <p className="mt-signal-summary">{feature.summary}</p>
                    <div className="mt-feature-evidence">
                      {feature.examples.map((example) => {
                        const record = source(example.evidence_id);
                        if (!record) return null;
                        return (
                          <a
                            key={record.id}
                            href={record.source_uri}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-example"
                          >
                            <div>
                              <strong>{record.brand}</strong>
                              <span>{example.status}</span>
                              <ArrowUpRight size={15} />
                            </div>
                            <p>{record.passage}</p>
                            <small>
                              {example.geography} · {record.published_on}
                            </small>
                          </a>
                        );
                      })}
                    </div>
                    <p className="mt-implication">
                      <span>For BMW</span>
                      {feature.question}
                    </p>
                    <div className="mt-signal-bottom">
                      <span>
                        {feature.study_ids.length
                          ? `${feature.study_ids.length} relevant ${scope.vehicle} study items`
                          : `No matching ${scope.vehicle} study items`}{" "}
                        · 2025 snapshot
                      </span>
                      <a
                        href="#market-context"
                        onClick={() => {
                          const el = document.getElementById("market-context");
                          if (el instanceof HTMLDetailsElement) el.open = true;
                        }}
                      >
                        Evidence & limits <ArrowUpRight size={14} />
                      </a>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="mt-signal-heading">
                      <span className="mt-eyebrow">01 / THE SIGNAL</span>
                      <span className="mt-type">
                        {signal?.kind ||
                          (topic === "Regional demand"
                            ? "Historical context"
                            : "Evidence gap")}
                      </span>
                    </div>
                    <h2>
                      {signal?.title ||
                        (topic === "Regional demand"
                          ? `${region}, in perspective.`
                          : "More evidence needed.")}
                    </h2>
                    <div
                      className={`mt-signal-number ${signal && !/[0-9]/.test(signal.headline) ? "mt-word-metric" : ""}`}
                    >
                      <strong>
                        {signal?.headline ||
                          (topic === "Regional demand" && yoy != null
                            ? `${yoy > 0 ? "+" : ""}${yoy.toFixed(1)}%`
                            : "—")}
                      </strong>
                      <span>
                        {signal?.unit ||
                          (topic === "Regional demand"
                            ? "BMW Group delivery change · 2024–2025"
                            : "No reviewed regional signal")}
                      </span>
                    </div>
                    <p className="mt-signal-summary">
                      {signal?.summary ||
                        (topic === "Regional demand"
                          ? source(group?.evidence_id)?.passage
                          : "No reviewed industry signal for this topic in this region. Run an analysis to inspect the available context and missing evidence.")}
                    </p>
                    <div className="mt-source-meta">
                      <span>{signal?.geography || region}</span>
                      <span>
                        {signal?.period ||
                          (topic === "Regional demand"
                            ? "2024–2025"
                            : "Coverage unavailable")}
                      </span>
                    </div>
                    {signal?.implication && (
                      <p className="mt-implication">
                        <span>For BMW</span>
                        {signal.implication}
                      </p>
                    )}
                    <div className="mt-signal-bottom">
                      {signals.length > 1 ? (
                        <label>
                          Explore signal
                          <select
                            aria-label="Industry signal"
                            value={Math.min(signalIndex, signals.length - 1)}
                            onChange={(e) =>
                              setSignalIndex(Number(e.target.value))
                            }
                          >
                            {signals.map((s, i) => (
                              <option key={s.id} value={i}>
                                {s.title}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : (
                        <span>
                          {source(signal?.evidence_id || group?.evidence_id)
                            ?.source_title || "Reviewed catalog"}
                        </span>
                      )}
                      <a
                        href="#market-context"
                        onClick={() => {
                          const el = document.getElementById("market-context");
                          if (el instanceof HTMLDetailsElement) el.open = true;
                        }}
                      >
                        View source <ArrowUpRight size={14} />
                      </a>
                    </div>
                  </>
                )}
              </section>
              <aside className="mt-agent" aria-label="Market agent">
                <div className="mt-agent-heading">
                  <span className="mt-eyebrow">02 / THE BMW PERSPECTIVE</span>
                  <Cpu size={18} />
                </div>
                {matches && rec ? (
                  <div className="mt-result">
                    <span className="mt-result-state">
                      Saved analysis ·{" "}
                      {result.position.stance.replaceAll("_", " ")}
                    </span>
                    <h2>{rec.proposed_change}</h2>
                    <div
                      className="mt-result-tabs"
                      aria-label="Recommendation detail"
                    >
                      {(["Benefit", "Trade-off", "Validate"] as const).map(
                        (tab) => (
                          <button
                            key={tab}
                            aria-pressed={resultTab === tab}
                            onClick={() => setResultTab(tab)}
                          >
                            {tab}
                          </button>
                        ),
                      )}
                    </div>
                    <div className="mt-result-detail" aria-live="polite">
                      {(resultTab === "Benefit"
                        ? rec.positive_effects.map((e) => e.description)
                        : resultTab === "Trade-off"
                          ? rec.negative_effects.map((e) => e.description)
                          : rec.validation_needed
                      ).map((text, i) => (
                        <p key={i}>{text}</p>
                      ))}
                      <small>
                        {resultTab === "Validate"
                          ? "A proposed test, not an approved requirement."
                          : "Possible outcome · not a measured effect."}
                      </small>
                    </div>
                    <details className="mt-reasoning">
                      <summary>
                        Reasoning & evidence <ChevronDown size={14} />
                      </summary>
                      <p>{result.position.rationale}</p>
                      <p>
                        <strong>Counterpoint.</strong> {rec.rationale}
                      </p>
                      {result.position.claims.map((c) => (
                        <div className="mt-fact" key={c.id}>
                          <p>{c.text}</p>
                          {c.evidence_ids.map((id) => (
                            <SourceDetails
                              key={id}
                              source={result.evidence.find((e) => e.id === id)}
                            />
                          ))}
                        </div>
                      ))}
                      <ol>
                        {result.research_steps.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ol>
                      {result.uncertainties.map((u) => (
                        <p key={u}>{u}</p>
                      ))}
                    </details>
                  </div>
                ) : (
                  <div className="mt-agent-intro">
                    <div className="mt-agent-mark" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </div>
                    <h2>What it means for BMW.</h2>
                    <p>
                      Turn the evidence into one clear recommendation, with a
                      benefit, a trade-off and a test.
                    </p>
                    <span>
                      Grounded in {region} · BMW {scope.vehicle}
                    </span>
                  </div>
                )}
                {(busy || failedHere) && (
                  <div className="mt-job" role="status">
                    {busy && <LoaderCircle className="mt-spin" size={16} />}
                    <div>
                      <strong>
                        {failedHere
                          ? "Analysis needs a retry"
                          : job?.phase || "Starting analysis…"}
                      </strong>
                      <p>
                        {failedHere
                          ? "The answer did not pass the evidence checks. Retry to generate a corrected analysis."
                          : "Running locally. Your progress is saved if you leave."}
                      </p>
                      {failedHere && (
                        <details>
                          <summary>Technical detail</summary>
                          <p>{job?.error}</p>
                        </details>
                      )}
                      <small>
                        {job?.request.scope.market} · {job?.request.scope.topic}
                      </small>
                    </div>
                  </div>
                )}
                {(requestError ||
                  pollError ||
                  (runtime && !runtime.analysis_ready)) && (
                  <div className="mt-error" role="alert">
                    {requestError ||
                      pollError ||
                      runtime?.ollama_error ||
                      runtime?.index_error ||
                      "The local agent is not ready yet."}
                  </div>
                )}
                {result && !matches && (
                  <p className="mt-saved-note">
                    A saved analysis is available for {result.scope.market} /{" "}
                    {result.market_topic}. Select that scope to reopen it.
                  </p>
                )}
                <div className="mt-agent-actions">
                  {matches && rec && (
                    <Link
                      className="mt-primary"
                      to={`/council?agent=market&source_run=${result.run_id}`}
                    >
                      Bring to council <ArrowRight size={16} />
                    </Link>
                  )}
                  <button
                    className={matches && rec ? "mt-rerun" : "mt-primary"}
                    disabled={
                      busy ||
                      submitting ||
                      !runtime?.analysis_ready ||
                      (topic === "Feature trends" && !feature?.examples.length)
                    }
                    onClick={failedHere ? retryAnalysis : analyze}
                  >
                    {busy || submitting ? (
                      <LoaderCircle className="mt-spin" size={16} />
                    ) : null}
                    {busy || submitting
                      ? "Analyzing…"
                      : failedHere
                        ? "Retry analysis"
                        : matches && rec
                          ? "Run analysis again"
                          : "Analyze this trend"}
                    {!(matches && rec) && <ArrowRight size={16} />}
                  </button>
                  <small>
                    {matches && rec
                      ? "Debate starts only when you request it in council."
                      : "Local Qwen analysis · typically a few minutes"}
                  </small>
                </div>
              </aside>
            </div>
            <details className="mt-context" id="market-context">
              <summary>
                <span>
                  BMW context & sources
                  <small>
                    {data.evidence.length} source records · {data.as_of}
                  </small>
                </span>
                <span className="mt-context-preview">
                  BMW Group / {region}
                  <strong className="mt-change">
                    {yoy != null
                      ? `${yoy > 0 ? "+" : ""}${yoy.toFixed(1)}%`
                      : "—"}
                  </strong>
                  <ChevronDown size={16} />
                </span>
              </summary>
              <div className="mt-context-body">
                <div className="mt-chart-panel">
                  <div className="mt-section-head">
                    <h2>Regional volume</h2>
                    <div className="mt-chart-toggle">
                      <button
                        aria-pressed={chartLevel === "group"}
                        onClick={() => setChartLevel("group")}
                      >
                        BMW Group
                      </button>
                      <button
                        aria-pressed={chartLevel === "model"}
                        onClick={() => setChartLevel("model")}
                      >
                        Model inputs
                      </button>
                    </div>
                  </div>
                  <div className="mt-chart-legend">
                    <span>
                      <i />
                      {series?.title} · {region}
                    </span>
                    <small>
                      {chartLevel === "group"
                        ? "Reported annual deliveries"
                        : "Challenge-supplied volumes · all powertrains"}
                    </small>
                  </div>
                  <div
                    className="mt-chart"
                    role="img"
                    aria-label={`${series?.title}: ${points.map((p) => `${p.year}: ${p.value} vehicles`).join(", ")}`}
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={points}
                        margin={{ top: 20, right: 12, bottom: 4, left: 4 }}
                      >
                        <defs>
                          <linearGradient
                            id={chartId}
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="0%"
                              stopColor="#8cbaff"
                              stopOpacity={0.28}
                            />
                            <stop
                              offset="100%"
                              stopColor="#8cbaff"
                              stopOpacity={0}
                            />
                          </linearGradient>
                        </defs>
                        <CartesianGrid
                          vertical={false}
                          stroke="rgba(170,190,220,.1)"
                          strokeDasharray="3 6"
                        />
                        <XAxis
                          dataKey="year"
                          axisLine={false}
                          tickLine={false}
                          tick={{ fill: "#8195ac", fontSize: 12 }}
                          tickMargin={14}
                        />
                        <YAxis
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(value: number) =>
                            new Intl.NumberFormat("en", {
                              notation: "compact",
                            }).format(value)
                          }
                          tick={{ fill: "#8195ac", fontSize: 11 }}
                          width={50}
                        />
                        <Tooltip
                          contentStyle={{
                            background: "#111f30",
                            border: "1px solid #344861",
                            borderRadius: 12,
                            color: "#fff",
                          }}
                          formatter={(value) => [
                            Number(value).toLocaleString() + " vehicles",
                            "Volume",
                          ]}
                        />
                        <Area
                          type="linear"
                          dataKey="value"
                          stroke="#9ebfff"
                          strokeWidth={2.5}
                          fill={`url(#${chartId})`}
                          dot={{
                            r: 4,
                            fill: "#bfd3ff",
                            stroke: "#0b1522",
                            strokeWidth: 3,
                          }}
                          activeDot={{ r: 6 }}
                          isAnimationActive={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  {chartLevel === "model" && planning && (
                    <div className="mt-planning">
                      <span>2030 supplied planning input</span>
                      <strong>
                        {planning.value.toLocaleString()} vehicles
                      </strong>
                      <small>
                        Future assumption · deliberately separate from history
                      </small>
                    </div>
                  )}
                  <SourceDetails source={source(series?.evidence_id)} />
                </div>
                <div className="mt-source-panel">
                  <h2>
                    {feature
                      ? "Evidence for this feature"
                      : "Behind the signal"}
                  </h2>
                  {feature ? (
                    <>
                      {feature.examples.map((e) => (
                        <SourceDetails
                          key={e.evidence_id}
                          source={source(e.evidence_id)}
                          check={data.source_checks[e.evidence_id]}
                        />
                      ))}
                      {feature.evidence_ids.some(
                        (id) =>
                          data.source_checks[id]?.status === "needs_review",
                      ) && (
                        <p className="mt-review-date" role="status">
                          A source needs review. Its evidence is withheld from
                          new analyses until the page check or manual review
                          resolves the issue.
                        </p>
                      )}
                      <button
                        className="mt-source-check"
                        onClick={checkSources}
                        disabled={checkingSources}
                      >
                        {checkingSources ? (
                          <LoaderCircle className="mt-spin" size={14} />
                        ) : (
                          <RefreshCw size={14} />
                        )}{" "}
                        {checkingSources
                          ? "Checking publisher pages…"
                          : "Check online sources"}
                      </button>
                      <p className="mt-review-date">
                        Checks approved public pages for expected text. Review
                        dates stay unchanged; text matches do not verify claims.
                      </p>
                      {checkError && <p role="alert">{checkError}</p>}
                      <h3 className="mt-study-heading">BMW study context</h3>
                      {feature.study_ids.length ? (
                        feature.study_ids.map((id) => (
                          <SourceDetails key={id} source={source(id)} />
                        ))
                      ) : (
                        <p className="mt-review-date">
                          No matching study items for this model and region.
                          China G68 results are not attributed to G60.
                        </p>
                      )}
                    </>
                  ) : (
                    <SourceDetails
                      source={source(signal?.evidence_id || group?.evidence_id)}
                    />
                  )}

                  <details className="mt-source">
                    <summary>
                      Coverage & limitations <ChevronDown size={14} />
                    </summary>
                    <div>
                      <ul>
                        {data.coverage.map((c) => (
                          <li key={c}>{c}</li>
                        ))}
                      </ul>
                      <p>
                        Curated source snapshot. The top refresh reloads the
                        catalog. Online checks fetch approved pages; they do not
                        discover or approve new claims.
                      </p>
                    </div>
                  </details>
                </div>
              </div>
            </details>
          </>
        )}
      </div>
      <div className="mt-footnote">
        <span>Industry evidence. BMW perspective.</span>
        <span>AI interpretations require PM review.</span>
      </div>
    </div>
  );
}
