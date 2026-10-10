import { lazy, Suspense, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  Sparkles,
  Globe2,
  ShieldCheck,
} from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { vehicleNames } from "../lib/mock-data";
import type { Market, Powertrain, Scope, Vehicle } from "../lib/types";
import { Badge, Button, Loading, Modal } from "../components/ui/Primitives";
const VehicleViewer = lazy(() => import("../components/vehicle/VehicleViewer"));
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
      if (next.vehicle === "F70" && next.powertrain !== "Combustion")
        next.powertrain = "Combustion";
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
  return (
    <div className="home">
      <header className="home-nav">
        <a href="/" className="brand">
          <span className="brand-word">BMW</span>
          <span className="brand-divider" />
          <span className="brand-next">
            NEXT<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="home-nav-center">PRODUCT INTELLIGENCE</div>
        <div className="home-nav-right">
          <Badge>HACKATHON CONCEPT</Badge>
          <button
            className="profile"
            aria-label="About this prototype"
            onClick={() => setAbout(true)}
          >
            PM
          </button>
        </div>
      </header>
      <main className="home-main">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="blue-line" /> ENGINEERING THE NEXT CHAPTER
          </div>
          <h1>
            The next generation.
            <br />
            <span>Informed by intelligence.</span>
          </h1>
          <p>From customer voices to confident product decisions.</p>
        </div>
        <section className="hero-stage" aria-label="Vehicle studio">
          <span className="hero-watermark" aria-hidden="true">
            THE{" "}
            {scope.vehicle === "F70"
              ? "1"
              : scope.vehicle === "G70"
                ? "7"
                : "5"}
          </span>
          <div className="studio-caption">
            <span>YOUR STARTING POINT</span>
            <strong>BMW {vehicleNames[scope.vehicle]}</strong>
            <small>{scope.vehicle} · Next-generation planning</small>
          </div>
          <Suspense fallback={<Loading label="Opening the vehicle studio…" />}>
            <VehicleViewer />
          </Suspense>
          <div className="studio-index">
            <span>01 — 03</span>
            <div />
            <span>DRIVEN BY EVIDENCE</span>
          </div>
        </section>
        <div className="configuration">
          <div className="config-row">
            <label>
              <span>01 / SERIES</span>
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
              <span>02 / TARGET MARKET</span>
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
              <span>03 / POWERTRAIN</span>
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
              <span>04 / PLANNING HORIZON</span>
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
            <Sparkles size={21} />
            <input
              aria-label="Analysis goals"
              placeholder="What should BMW’s next generation prioritize?"
              value={scope.prompt}
              onChange={(e) => update("prompt", e.target.value)}
            />
            <Button type="submit">
              Start Product Analysis <ArrowRight size={18} />
            </Button>
          </form>
          <div className="prompt-suggestions">
            <span>TRY A DIRECTION</span>
            {[
              "Customer priorities",
              "Electric experience",
              "High impact, lower effort",
            ].map((label, i) => (
              <button key={label} onClick={() => update("prompt", prompts[i])}>
                {label}
                <ArrowUpRight size={12} />
              </button>
            ))}
          </div>
        </div>
        <div className="home-bottom">
          <p>
            <ShieldCheck size={14} /> AI analyzes. AI challenges.{" "}
            <strong>Humans decide.</strong>
          </p>
          {started ? (
            <button className="text-link" onClick={() => navigate("/overview")}>
              Resume your workspace <ArrowRight size={14} />
            </button>
          ) : (
            <span>
              <Globe2 size={14} /> Munich, 2026{" "}
              <span className="separator">/</span> Synthetic demo data
            </span>
          )}
        </div>
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
            The rotatable sedan is a CC0 concept asset from Innerscene, not an
            accurate BMW vehicle. BMW text is used to identify the challenge; no
            licensed BMW roundel was supplied.
          </p>
        </Modal>
      )}
    </div>
  );
}
