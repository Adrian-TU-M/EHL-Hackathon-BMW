import { lazy, Suspense, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  Sparkles,
  ShieldCheck,
  ChevronDown,
  Activity,
  Layers3,
  ScanLine,
} from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { vehicleNames } from "../lib/mock-data";
import { vehicles } from "../lib/vehicles";
import type { Market, Powertrain, Scope, Vehicle } from "../lib/types";
import { Badge, Button, Loading, Modal } from "../components/ui/Primitives";
const VehicleViewer = lazy(() => import("../components/vehicle/VehicleViewer"));
const IntelligenceShader = lazy(
  () => import("../components/ui/IntelligenceShader"),
);
const prompts = [
  "Explore customer priorities for the next BMW 5 Series in Europe.",
  "Prioritize electric driving experience and charging convenience.",
  "Find high-impact improvements with lower implementation effort.",
];
export default function Home() {
  const previous = useAppStore((s) => s.scope);
  const started = useAppStore((s) => s.started);
  const start = useAppStore((s) => s.startAnalysis);
  const [scope, setScope] = useState<Scope>(previous);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [about, setAbout] = useState(false);
  const navigate = useNavigate();
  function update<K extends keyof Scope>(key: K, value: Scope[K]) {
    setScope((s) => {
      const next = { ...s, [key]: value };
      if (next.vehicle === "F70") next.powertrain = "Combustion";
      return next;
    });
  }
  async function begin() {
    setBusy(true);
    try {
      await start(scope);
      navigate("/overview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the demo.");
      setBusy(false);
    }
  }
  const selected = vehicles[scope.vehicle];
  return (
    <div className="home premium-home">
      <header className="home-nav">
        <a href="/" className="brand" aria-label="BMW NEXT home">
          <img src="/images/bmw-logo.svg" alt="BMW" className="bmw-roundel" />
          <span className="brand-divider" />
          <span className="brand-next">
            NEXT<span className="brand-dot">.</span>
            <small>PRODUCT INTELLIGENCE</small>
          </span>
        </a>
        <nav className="home-links" aria-label="Homepage navigation">
          <a href="#model-selection">The vehicles</a>
          <a href="#intelligence">The intelligence</a>
          <a href="#analysis-setup">
            Your next move <ArrowUpRight size={14} />
          </a>
        </nav>
        <button className="concept-tag" onClick={() => setAbout(true)}>
          <span /> HACKATHON CONCEPT
        </button>
      </header>
      <main className="home-main">
        <section className="showroom-hero" aria-label="Vehicle studio">
          <Suspense fallback={<Loading label="Opening the vehicle studio…" />}>
            <VehicleViewer vehicle={scope.vehicle} />
          </Suspense>
          <div className="hero-editorial">
            <div className="eyebrow">
              <span className="blue-line" /> THE FUTURE IS A DECISION.
            </div>
            <h1>
              Make the
              <br />
              next move<span>matter.</span>
            </h1>
            <p>
              Customer insight. Collective intelligence.
              <br />
              The next chapter of BMW, shaped by you.
            </p>
            <a href="#analysis-setup" className="button primary">
              Define what’s next <ArrowRight size={18} />
            </a>
          </div>
          <div className="hero-series" aria-hidden="true">
            THE <strong key={scope.vehicle}>{selected.series}</strong>
          </div>
          <div className="hero-bottom-line">
            <div>
              <span>{scope.vehicle} / DESIGN REFERENCE</span>
              <h2>{selected.name}</h2>
              <p>{selected.line}</p>
            </div>
            <a href="#model-selection">
              DISCOVER YOUR STARTING POINT <ChevronDown size={16} />
            </a>
          </div>
        </section>
        <section id="model-selection" className="model-selection">
          <div className="section-intro">
            <div>
              <div className="eyebrow">01 / CHOOSE YOUR STARTING POINT</div>
              <h2>
                Different characters. <span>One ambition.</span>
              </h2>
            </div>
            <p>Choose a BMW series to frame your next-generation analysis.</p>
          </div>
          <div
            className="model-cards"
            role="group"
            aria-label="Select a BMW series"
          >
            {(Object.keys(vehicles) as Vehicle[]).map((id) => {
              const car = vehicles[id];
              return (
                <button
                  key={id}
                  aria-pressed={scope.vehicle === id}
                  onClick={() => update("vehicle", id)}
                  className={`model-card ${scope.vehicle === id ? "selected" : ""}`}
                >
                  <div className="model-card-photo">
                    <img
                      src={car.image}
                      alt={`${car.name} ${id}`}
                      loading="lazy"
                    />
                    <span className="model-number">{car.series}</span>
                    <span className="model-check">
                      {scope.vehicle === id ? "SELECTED" : "EXPLORE"}
                    </span>
                  </div>
                  <div className="model-card-info">
                    <div>
                      <span>
                        {id} · {car.body}
                      </span>
                      <h3>{car.name}</h3>
                    </div>
                    <ArrowUpRight size={21} />
                  </div>
                </button>
              );
            })}
          </div>
        </section>
        <section id="analysis-setup" className="analysis-setup">
          <div className="setup-intro">
            <div className="eyebrow">02 / SET THE DIRECTION</div>
            <h2>
              Big questions.
              <br />
              <span>Clearer answers.</span>
            </h2>
            <p>
              Define your market and priorities. Your council connects the
              signals and brings the trade-offs into focus.
            </p>
            <div className="setup-assurance">
              <ShieldCheck size={18} />
              <span>
                AI analyzes and challenges.
                <br />
                <strong>You make the decision.</strong>
              </span>
            </div>
          </div>
          <div className="configuration">
            <div className="config-heading">
              <span className="live-dot" /> ANALYSIS BRIEF{" "}
              <Badge tone="blue">SYNTHETIC DEMO</Badge>
            </div>
            <div className="config-row">
              <label>
                <span>BMW SERIES</span>
                <select
                  aria-label="Series"
                  value={scope.vehicle}
                  onChange={(e) => update("vehicle", e.target.value as Vehicle)}
                >
                  {Object.entries(vehicleNames).map(([id, name]) => (
                    <option key={id} value={id}>
                      BMW {name} · {id}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>TARGET MARKET</span>
                <select
                  aria-label="Market"
                  value={scope.market}
                  onChange={(e) => update("market", e.target.value as Market)}
                >
                  {["Europe", "United States", "China"].map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>POWERTRAIN</span>
                <select
                  aria-label="Powertrain"
                  value={scope.powertrain}
                  onChange={(e) =>
                    update("powertrain", e.target.value as Powertrain)
                  }
                >
                  {(scope.vehicle === "F70"
                    ? ["Combustion"]
                    : ["Electric", "Plug-in hybrid", "Combustion"]
                  ).map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>PLANNING HORIZON</span>
                <select
                  aria-label="Planning horizon"
                  value={scope.horizon}
                  onChange={(e) => update("horizon", Number(e.target.value))}
                >
                  {[3, 4, 5].map((y) => (
                    <option value={y} key={y}>
                      {y} years · {2026 + y}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <form
              className="prompt-row"
              onSubmit={(e) => {
                e.preventDefault();
                setConfirm(true);
              }}
            >
              <label htmlFor="analysis-goals">
                <Sparkles size={17} /> What should the next generation
                prioritize?
              </label>
              <textarea
                id="analysis-goals"
                aria-label="Analysis goals"
                placeholder="A more intuitive cockpit. A better charging experience. What comes next?"
                value={scope.prompt}
                onChange={(e) => update("prompt", e.target.value)}
              />
              <div className="prompt-suggestions">
                {[
                  "Customer priorities",
                  "Electric experience",
                  "High impact, lower effort",
                ].map((label, i) => (
                  <button
                    type="button"
                    key={label}
                    onClick={() => update("prompt", prompts[i])}
                  >
                    {label}
                    <ArrowUpRight size={12} />
                  </button>
                ))}
              </div>
              <Button type="submit">
                Start Product Analysis <ArrowRight size={18} />
              </Button>
            </form>
            {started && (
              <button
                className="text-link resume-workspace"
                onClick={() => navigate("/overview")}
              >
                Resume your existing workspace <ArrowRight size={14} />
              </button>
            )}
          </div>
        </section>
        <section id="intelligence" className="intelligence-section">
          <Suspense fallback={null}>
            <IntelligenceShader />
          </Suspense>
          <div className="intelligence-copy">
            <div className="eyebrow">03 / INTELLIGENCE WITH PERSPECTIVE</div>
            <h2>
              More than an answer.
              <br />
              <span>A considered direction.</span>
            </h2>
            <p>
              Three independent perspectives. A moderator to connect them. A
              judge to test the evidence. And you, in control of what happens
              next.
            </p>
          </div>
          <div className="intelligence-points">
            {[
              {
                icon: Activity,
                title: "Listen to the signals",
                text: "Customer voices, market direction and competitive context — together in one place.",
              },
              {
                icon: Layers3,
                title: "Challenge the obvious",
                text: "Watch the council compare perspectives, expose uncertainty and refine proposals.",
              },
              {
                icon: ScanLine,
                title: "Decide with confidence",
                text: "Compare scenarios, trace every source and approve the direction with a clear rationale.",
              },
            ].map(({ icon: Icon, title, text }, i) => (
              <div key={title}>
                <span className="intelligence-point-number">0{i + 1}</span>
                <Icon size={24} />
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            ))}
          </div>
        </section>
        <footer className="home-footer">
          <a href="/" className="brand">
            <img src="/images/bmw-logo.svg" alt="BMW" className="bmw-roundel" />
            <span className="brand-next">NEXT.</span>
          </a>
          <span>
            An independent hackathon concept.
            <br />
            Real vehicle references. Synthetic product intelligence.
          </span>
          <button className="text-link" onClick={() => setAbout(true)}>
            About this experience <ArrowUpRight size={14} />
          </button>
        </footer>
      </main>
      {confirm && (
        <Modal title="Set the direction" onClose={() => setConfirm(false)}>
          <p className="muted">
            Confirm the context your AI council will explore.
          </p>
          <dl className="scope-confirm">
            <div>
              <dt>Vehicle</dt>
              <dd>
                BMW {vehicleNames[scope.vehicle]} · {scope.vehicle}
              </dd>
            </div>
            <div>
              <dt>Market / derivative</dt>
              <dd>
                {scope.market} · {scope.powertrain}
              </dd>
            </div>
            <div>
              <dt>Planning horizon</dt>
              <dd>
                {scope.horizon} years · through {2026 + scope.horizon}
              </dd>
            </div>
            <div>
              <dt>Goal</dt>
              <dd>
                {scope.prompt ||
                  "Explore customer priorities with a balanced strategy."}
              </dd>
            </div>
          </dl>
          <div className="notice">
            <p>
              <strong>Demo mode.</strong> This session uses synthetic fixtures
              and scripted agent statements. Selections define the demo context;
              actual derivative availability requires validation.{" "}
              {started &&
                "Starting a new analysis replaces the current locally saved session; export it first if needed."}
            </p>
          </div>
          {error && <p className="error">{error}</p>}
          <Button onClick={begin} disabled={busy}>
            {busy ? "Preparing…" : "Confirm scope & begin"}
            <ArrowRight size={16} />
          </Button>
        </Modal>
      )}
      {about && (
        <Modal title="BMW NEXT / Concept" onClose={() => setAbout(false)}>
          <p>
            An unofficial product intelligence prototype for the TUM AI
            Hackathon BMW challenge.
          </p>
          <p>
            All evidence and council responses are synthetic. Browser storage
            preserves your demo session on this device. No real AI service,
            login, or confidential dataset is connected.
          </p>
          <p>
            BMW reference photographs and the BMW roundel identify the
            challenge. The optional 3D viewers show independently created BMW
            models on Sketchfab. They are visual references, not engineering
            simulations. This concept is not an official BMW product.
          </p>
        </Modal>
      )}
    </div>
  );
}
