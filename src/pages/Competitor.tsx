import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import {
  api,
  LiveApiError,
  post,
  brands,
  type Source,
  type Runtime,
  type Analysis,
  type Job,
} from "../lib/api/live";
import { useLiveJob } from "../lib/api/useLiveJob";
import "./competitor.css";
const titles: Record<string, string> = {
  "tesla-model3-us-rear-screen-20261010":
    "Rear passenger touchscreen (where fitted)",
  "tesla-model3-uk-rear": "Rear passenger touchscreen (where fitted)",
  "tesla-model3-uk-controls": "Searchable controls and voice commands",
  "tesla-model3-uk-rear-lock": "Front control of the rear screen",
  "byd-seal-uk-2026-display": "Fixed 15.6-inch touchscreen",
  "byd-seal-uk-2026-hud": "Head-up display on Excellence",
  "byd-seal-uk-2026-comfort": "Heated and ventilated seats / Dynaudio audio",
  "byd-seal-uk-2026-access": "Bluetooth key and driver monitoring",
  "byd-seal-uk-2026-charge": "150 kW DC charging claim",
  "mercedes-eqs-uk-hyperscreen": "MBUX Hyperscreen",
  "mercedes-eqs-uk-entertainment": "Entertainment Digital Extra",
  "mercedes-eqs-uk-parking": "360-degree parking views",
  "mercedes-eqs-uk-dashcam": "Integrated dashcam",
  "mercedes-aclass-uk-mbux": "MBUX display and wireless connectivity",
  "mercedes-aclass-uk-ar-navigation": "Augmented reality navigation",
  "byd-seal6-dmi-uk-display": "15.6-inch floating touchscreen",
  "byd-seal6-dmi-uk-seats": "Seat comfort and memory functions",
  "audi-a6-etron-uk-passenger-20261010": "Front passenger display",
  "audi-a6-etron-uk-roof-20261010": "Switchable panoramic roof",
  "vw-id7-uk-smartglass-20261010": "Smart Glass roof",
  "vw-id7-uk-hud-20261010": "Augmented reality head-up display",
  "xpeng-g6-fr-charging-20261010": "12-minute charging claim",
  "nio-et5t-de-swap-20261010": "Battery swapping with parking assist",
};
function previousSelection(): {
  brand?: string;
  model?: string;
  featureId?: string;
} {
  try {
    const p = JSON.parse(
      localStorage.getItem("bmw-competitor-selection-v1") || "{}",
    );
    return {
      brand: brands.some((b) => b.name === p?.brand) ? p.brand : "Audi",
      model: typeof p?.model === "string" ? p.model : "",
      featureId: typeof p?.featureId === "string" ? p.featureId : "",
    };
  } catch {
    return {};
  }
}
export default function Competitor() {
  const scope = useAppStore((s) => s.scope);
  const [sources, setSources] = useState<Source[]>([]);
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [error, setError] = useState("");
  const [brand, setBrand] = useState(() => previousSelection().brand || "Audi");
  const [model, setModel] = useState(() => previousSelection().model || "");
  const [featureId, setFeatureId] = useState(
    () => previousSelection().featureId || "",
  );
  const [submitting, setSubmitting] = useState(false);
  const {
    job,
    error: pollError,
    attach,
    reserve,
    discard,
    busy,
  } = useLiveJob<Analysis>("bmw-live-analysis-job");
  useEffect(() => {
    try {
      localStorage.setItem(
        "bmw-competitor-selection-v1",
        JSON.stringify({ brand, model, featureId }),
      );
    } catch {
      /* Optional persistence. */
    }
  }, [brand, model, featureId]);
  async function refresh() {
    setError("");
    try {
      const [s, r] = await Promise.all([
        api<{ records: Source[] }>("/competitor/sources"),
        api<Runtime>("/competitor/status"),
      ]);
      setSources(s.records);
      setRuntime(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load backend.");
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  const eligible = sources.filter(
    (r) =>
      r.eligible_for_current_search &&
      r.market === scope.market &&
      (!r.powertrain || r.powertrain === scope.powertrain),
  );
  const models = [
    ...new Set(eligible.filter((r) => r.brand === brand).map((r) => r.model)),
  ];
  const selectedModel = models.includes(model) ? model : models[0] || "";
  const features = eligible.filter(
    (r) => r.brand === brand && r.model === selectedModel,
  );
  const feature = features.find((r) => r.id === featureId) || features[0];
  const result = job?.status === "succeeded" && job.kind === "analysis" ? job.result : null;
  const matches =
    !!result &&
    result.competitor_brand === brand &&
    result.competitor_model === selectedModel &&
    result.scope.vehicle === scope.vehicle &&
    result.scope.market === scope.market &&
    result.scope.powertrain === scope.powertrain &&
    result.scope.horizon === scope.horizon &&
    result.scope.topic === (feature?.categories[0] || "") &&
    result.requested_evidence_ids.includes(feature?.id || "");
  async function analyze() {
    if (!feature || submitting || busy) return;
    setSubmitting(true);
    setError("");
    const clientJobId = reserve();
    try {
      attach(
        await post<Job<Analysis>>("/competitor/jobs", {
          client_job_id: clientJobId,
          analysis_id: crypto.randomUUID(),
          scope: {
            vehicle: scope.vehicle,
            market: scope.market,
            powertrain: scope.powertrain,
            horizon: scope.horizon,
            topic: feature.categories[0],
          },
          competitor_brand: brand,
          competitor_model: selectedModel,
          evidence_ids: [feature.id],
        }),
      );
    } catch (e) {
      if (e instanceof LiveApiError && [409, 422].includes(e.status)) discard();
      setError(e instanceof Error ? e.message : "Analysis failed.");
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <div className="cx-page">
      <header className="cx-header">
        <div>
          <span className="eyebrow">03 / COMPETITOR INTELLIGENCE</span>
          <h1>What could BMW do better?</h1>
          <p>
            Choose a brand and model. Compare a feature. Ask the agent to
            investigate.
          </p>
        </div>
        <div className="cx-runtime">
          <span
            className={runtime?.analysis_ready ? "cx-dot ready" : "cx-dot"}
          />
          {runtime?.analysis_ready ? "Local agent ready" : "Agent not ready"}
          <small>{runtime?.model || "Checking Ollama…"}</small>
          <button onClick={refresh} aria-label="Refresh agent status">
            <RefreshCw size={14} />
          </button>
        </div>
      </header>
      {(error || pollError) && (
        <div role="alert" className="cx-error">
          {error || pollError}
          <button onClick={refresh}>Retry connection</button>
        </div>
      )}
      {runtime && !runtime.analysis_ready && (
        <p className="cx-note">
          {runtime.index_error ||
            runtime.ollama_error ||
            "The local agent is unavailable."}
        </p>
      )}
      <div
        className="cx-brand-picker"
        role="group"
        aria-label="Choose competitor brand"
      >
        {brands.map((b) => (
          <button
            aria-pressed={brand === b.name}
            className={brand === b.name ? "selected" : ""}
            key={b.name}
            onClick={() => {
              setBrand(b.name);
              setModel("");
              setFeatureId("");
            }}
          >
            <img src={`/images/competitors/${b.logo}`} alt="" />
            <span>{b.name}</span>
          </button>
        ))}
      </div>
      <div className="cx-selection">
        <label>
          Competitor model
          <select
            aria-label="Competitor model"
            value={selectedModel}
            onChange={(e) => {
              setModel(e.target.value);
              setFeatureId("");
            }}
          >
            {models.length ? (
              models.map((m) => <option key={m}>{m}</option>)
            ) : (
              <option value="">No matching references</option>
            )}
          </select>
        </label>
        <div>
          <span>COMPARE WITH</span>
          <strong>BMW {scope.vehicle}</strong>
          <small>
            {scope.market} · {scope.powertrain}
          </small>
        </div>
      </div>
      {feature ? (
        <>
          <div className="cx-feature-picker">
            <label htmlFor="cx-feature">Feature to investigate</label>
            <select
              id="cx-feature"
              value={feature.id}
              onChange={(e) => setFeatureId(e.target.value)}
            >
              {features.map((f, i) => (
                <option key={f.id} value={f.id}>
                  {titles[f.id] || `${f.categories.join(" / ")} · ${i + 1}`}
                </option>
              ))}
            </select>
          </div>
          <section className="cx-comparison" aria-label="Feature comparison">
            <article>
              <span className="cx-label">
                <CheckCircle2 size={15} /> DOCUMENTED FOR THE COMPETITOR
              </span>
              <h2>{titles[feature.id] || feature.categories.join(" / ")}</h2>
              <p>{feature.passage}</p>
              <div className="cx-source-tag">
                {feature.country}{" "}
                {feature.trim
                  ? `· ${feature.trim}`
                  : "· Fitment qualifications apply"}
              </div>
              <a href={feature.source_uri} target="_blank" rel="noreferrer">
                Official source <ArrowUpRight size={15} />
              </a>
            </article>
            <article className="cx-bmw">
              <img src="/images/bmw-logo.svg" alt="BMW" />
              <span className="cx-label">BMW {scope.vehicle}</span>
              <h2>Gap not yet verified</h2>
              <p>
                The selected BMW country, model year and trim need checking. A
                competitor having a feature does not establish that BMW lacks
                it.
              </p>
              <strong className="cx-unknown">Unknown ≠ unavailable</strong>
            </article>
            <article className="cx-success">
              <span className="cx-label">MEASURED SUCCESS</span>
              <strong>—</strong>
              <h3>No attributable percentage</h3>
              <p>
                This source does not measure how much this feature caused sales
                or customer success. BMW benefit is a hypothesis to test.
              </p>
            </article>
          </section>
          <div className="cx-action">
            <div>
              <strong>Get BMW’s competitive response.</strong>
              <p>
                Qwen checks scoped BMW evidence, looks for counterevidence and
                proposes benefits, risks and validation.
              </p>
            </div>
            <button
              className="button primary"
              disabled={!runtime?.analysis_ready || busy || submitting}
              onClick={analyze}
            >
              {busy || submitting ? (
                <LoaderCircle className="cx-spin" size={17} />
              ) : (
                <ArrowRight size={17} />
              )}{" "}
              {busy ? "Agent working…" : "Analyze this feature"}
            </button>
          </div>
          <details className="cx-details">
            <summary>Source scope & verification</summary>
            <p>
              Reviewed {feature.verified_on} · Review due{" "}
              {feature.review_due_on}. Country-specific reference, not
              necessarily a segment-equivalent peer.
            </p>
            <ul>
              {feature.caveats.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </details>
        </>
      ) : (
        <section className="cx-empty">
          <h2>No reviewed {brand} reference for this scope.</h2>
          <p>
            {scope.market} · {scope.powertrain}. Choose another brand or change
            your analysis scope. We do not infer missing equipment from missing
            data.
          </p>
        </section>
      )}
      {(busy || job?.status === "failed") && (
        <div className="cx-progress" role="status">
          <strong>{job?.phase || "Restoring saved job…"}</strong>
          <p>
            {job?.error ||
              "Runs continue on this laptop if you navigate away. Real research may take several minutes."}
          </p>
          <small>
            {job?.request.scope.vehicle} · {job?.request.scope.market} ·{" "}
            {job?.request.scope.topic}
          </small>
        </div>
      )}
      {result && !matches && (
        <p className="cx-note">
          Your saved result belongs to a different selection. Run a fresh
          analysis for the current feature.
        </p>
      )}
      {result && matches && (
        <section className="cx-result" aria-labelledby="cx-result-title">
          <div className="cx-result-head">
            <div>
              <span className="eyebrow">LIVE QWEN RESULT / {result.model}</span>
              <h2 id="cx-result-title">
                The competitor agent’s recommendation
              </h2>
            </div>
            <Link
              className="button primary"
              to={`/council?source_run=${result.run_id}`}
            >
              Bring to council <ArrowRight size={16} />
            </Link>
          </div>
          <p>{result.position.rationale}</p>
          {result.recommendations.length ? (
            result.recommendations.map((r, i) => (
              <article className="cx-recommendation" key={i}>
                <h3>{r.title}</h3>
                <p>{r.proposed_change}</p>
                <div className="cx-benefits">
                  <div>
                    <span>POTENTIAL BMW BENEFIT</span>
                    {r.positive_effects.map((e, i) => (
                      <p key={i}>{e.description}</p>
                    ))}
                  </div>
                  <div>
                    <span>TRADE-OFF TO CHECK</span>
                    {r.negative_effects.map((e, i) => (
                      <p key={i}>{e.description}</p>
                    ))}
                  </div>
                </div>
                <details>
                  <summary>What must be validated?</summary>
                  <ul>
                    {r.validation_needed.map((v) => (
                      <li key={v}>{v}</li>
                    ))}
                  </ul>
                </details>
              </article>
            ))
          ) : (
            <p>
              No grounded recommendation could be established. The council can
              discuss the evidence gaps.
            </p>
          )}
          <details className="cx-details">
            <summary>Evidence, agent claims & limitations</summary>
            {result.position.claims.map((c) => (
              <div key={c.id}>
                <strong>{c.kind}</strong>
                <p>{c.text}</p>
                <small>{c.evidence_ids.join(" · ")}</small>
              </div>
            ))}
            {result.evidence.map((s) => (
              <details key={s.id}>
                <summary>
                  {s.brand} · {s.source_title}
                </summary>
                <p>{s.passage}</p>
                <small>
                  {s.id} · {s.locator}
                </small>
              </details>
            ))}
            <ul>
              {result.uncertainties.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
            <p>{result.research_steps.join(" → ")}</p>
            <small>Saved run {result.run_id}</small>
          </details>
          <p className="cx-note">
            Opening the council does not start a debate. Only your “Start live
            debate” click does.
          </p>
        </section>
      )}
      <footer className="cx-note">
        <ShieldCheck size={14} /> Official-source references · no invented gaps
        or success scores
      </footer>
    </div>
  );
}
