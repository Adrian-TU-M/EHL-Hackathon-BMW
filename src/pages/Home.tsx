import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import "../styles/home-landing.css";

export default function Home() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function enterPlatform() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const workspace = useAppStore.getState();
      if (!workspace.started) await workspace.startAnalysis(workspace.scope);
      navigate("/council");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not open the platform. Please try again.",
      );
      setBusy(false);
    }
  }

  return (
    <div className="home premium-home landing-home">
      <header className="home-nav">
        <Link to="/" className="brand" aria-label="BMW NEXT home">
          <img src="/images/bmw-logo.svg" alt="BMW" className="bmw-roundel" />
          <span className="brand-divider" />
          <span className="brand-next">
            NEXT<span className="brand-dot">.</span>
            <small>PRODUCT INTELLIGENCE</small>
          </span>
        </Link>
        <span className="concept-tag">
          <span /> HACKATHON CONCEPT
        </span>
      </header>
      <main className="home-main">
        <section className="landing-hero" aria-labelledby="landing-title">
          <img
            className="landing-photo"
            src="/images/bmw-g70.webp"
            alt=""
            fetchPriority="high"
          />
          <div className="landing-vignette" aria-hidden="true" />
          <div className="hero-editorial">
            <div className="eyebrow">
              <span className="blue-line" /> THE FUTURE IS A DECISION.
            </div>
            <h1 id="landing-title">
              Make the
              <br />
              next move<span>matter.</span>
            </h1>
            <p>
              Customer insight. Collective intelligence.
              <br />
              The next chapter of BMW, shaped by you.
            </p>
            <button
              className="button primary"
              onClick={enterPlatform}
              disabled={busy}
            >
              {busy ? "Opening your workspace…" : "Take a deeper dive"}{" "}
              <ArrowRight size={18} />
            </button>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
