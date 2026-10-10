import { lazy, Suspense, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  FileText,
  Orbit,
  Sparkles,
  AlertCircle,
  ScanLine,
} from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import {
  Badge,
  Button,
  PageHeader,
  SectionTitle,
  Stat,
  Loading,
  StatusBadge,
} from "../components/ui/Primitives";
import { EvidenceDialog } from "../components/dashboard/EvidenceDialog";
import { ranked, scoreRequirement } from "../lib/scoring";
import { vehicleNames } from "../lib/mock-data";
import type { Topic } from "../lib/types";
const VehicleViewer = lazy(() => import("../components/vehicle/VehicleViewer"));
export default function Overview() {
  const { scope, evidence, requirements, weights, council, audit } =
    useAppStore();
  const [area, setArea] = useState<Topic>("Displays");
  const [evidenceIds, setEvidenceIds] = useState<string[] | null>(null);
  const navigate = useNavigate();
  const top = ranked(requirements, weights);
  const related = requirements.filter((r) => r.topic === area);
  return (
    <>
      <PageHeader
        eyebrow="THE BIG PICTURE"
        title="A clearer view of what’s next."
        description={`Your intelligence brief for the next BMW ${vehicleNames[scope.vehicle]} in ${scope.market}.`}
        action={
          <Button onClick={() => navigate("/council")}>
            <Orbit size={17} /> Enter the council <ArrowUpRight size={16} />
          </Button>
        }
      />
      <div className="stat-grid">
        <Stat
          label="Evidence records"
          value={evidence.filter((e) => !e.exclusionReason).length}
          detail="Synthetic, source-linked fixtures"
        />
        <Stat
          label="Proposed requirements"
          value={requirements.length}
          detail="Customer-facing opportunities"
        />
        <Stat
          label="Awaiting your review"
          value={
            requirements.filter((r) => r.status === "Pending review").length
          }
          detail="Your perspective makes the difference"
        />
        <Stat
          label="Council perspectives"
          value="03 + 02"
          detail="Specialists, moderator & judge"
        />
      </div>
      <div className="overview-main">
        <section className="panel vehicle-panel">
          <div className="panel-padding">
            <SectionTitle
              title="Explore the opportunity"
              detail="Select an area to connect the vehicle with customer needs."
              action={<Badge>{scope.powertrain}</Badge>}
            />
          </div>
          <Suspense fallback={<Loading />}>
            <VehicleViewer compact />
          </Suspense>
          <div className="area-tabs" aria-label="Vehicle requirement areas">
            {requirements.map((r) => (
              <button
                key={r.topic}
                className={r.topic === area ? "active" : ""}
                onClick={() => setArea(r.topic)}
              >
                <span />
                {r.topic}
              </button>
            ))}
          </div>
          <div className="area-detail">
            <div className="flex-between">
              <span className="eyebrow">{area} / REQUIREMENT AREA</span>
              <ScanLine size={18} />
            </div>
            {related.map((r) => (
              <div key={r.id}>
                <h3>{r.title}</h3>
                <p>{r.description}</p>
                <div className="flex-between">
                  <div className="flex">
                    <StatusBadge status={r.status} />
                    <span className="small muted">
                      Impact {r.impact}/5 · Risk {r.risk}/5
                    </span>
                  </div>
                  <button
                    className="text-link"
                    onClick={() => setEvidenceIds(r.evidenceIds)}
                  >
                    Explore {r.evidenceIds.length} sources{" "}
                    <ArrowUpRight size={14} />
                  </button>
                </div>
              </div>
            ))}
            <small className="area-disclaimer">
              Category navigation · concept geometry does not represent exact
              BMW locations.
            </small>
          </div>
        </section>
        <div className="overview-side">
          <section className="council-invite">
            <div className="eyebrow">
              <span className="live-dot" /> INTELLIGENCE, IN DIALOGUE
            </div>
            <div className="orb-art">
              <span />
              <span />
              <span />
            </div>
            <h2>
              Better decisions begin
              <br />
              with different perspectives.
            </h2>
            <p>
              Let your AI council examine the evidence, challenge assumptions,
              and shape a proposal.
            </p>
            <Button onClick={() => navigate("/council")}>
              {council.status === "idle"
                ? "Meet your council"
                : "Return to the council"}
              <ArrowRight size={16} />
            </Button>
            <div className="council-invite-footer">
              3 specialist perspectives <span>1 human decision-maker</span>
            </div>
          </section>
          <section className="panel panel-padding assumptions-panel">
            <SectionTitle
              title="Keep these in view"
              action={<AlertCircle size={18} />}
            />
            <div className="assumption-item">
              <span>01</span>
              <div>
                <strong>Evidence is illustrative</strong>
                <p>No supplied BMW datasets have been analyzed.</p>
              </div>
            </div>
            <div className="assumption-item">
              <span>02</span>
              <div>
                <strong>Feasibility needs validation</strong>
                <p>
                  Effort and impact ratings are qualitative demo assessments.
                </p>
              </div>
            </div>
            <button
              className="text-link"
              onClick={() => navigate("/decisions")}
            >
              Explore assumptions <ArrowUpRight size={15} />
            </button>
          </section>
        </div>
      </div>
      <section className="panel panel-padding top-findings">
        <SectionTitle
          title="The emerging priorities"
          detail="A transparent ranking, ready for your perspective."
          action={
            <button
              className="text-link"
              onClick={() => navigate("/decisions")}
            >
              All requirements <ArrowRight size={15} />
            </button>
          }
        />
        {top.slice(0, 3).map((r, i) => (
          <div className="finding-row" key={r.id}>
            <span className="finding-number">0{i + 1}</span>
            <div>
              <span className="eyebrow">
                {r.topic} <span className="muted">/ {r.id}</span>
              </span>
              <h3>{r.title}</h3>
            </div>
            <div className="finding-score">
              <strong>{scoreRequirement(r, weights).score}</strong>
              <span>PRIORITY / 100</span>
            </div>
            <button
              className="icon-button"
              aria-label={`View evidence for ${r.title}`}
              onClick={() => setEvidenceIds(r.evidenceIds)}
            >
              <ArrowUpRight size={20} />
            </button>
          </div>
        ))}
      </section>
      <div className="overview-bottom-grid">
        <section className="panel panel-padding">
          <SectionTitle
            title="From signal to insight"
            detail="Explore each specialist’s evidence."
          />
          <div className="shortcut-grid">
            {[
              {
                title: "Customer intelligence",
                detail: "Needs, friction & qualities to preserve",
                path: "/customer",
                icon: FileText,
              },
              {
                title: "Market trends",
                detail: "Context, direction & future assumptions",
                path: "/market",
                icon: Sparkles,
              },
              {
                title: "Competitor intelligence",
                detail: "Comparisons, gaps & opportunities",
                path: "/competitor",
                icon: ScanLine,
              },
            ].map(({ title, detail, path, icon: Icon }) => (
              <button key={path} onClick={() => navigate(path)}>
                <Icon size={20} />
                <strong>{title}</strong>
                <span>{detail}</span>
                <ArrowUpRight size={16} />
              </button>
            ))}
          </div>
        </section>
        <section className="panel panel-padding">
          <SectionTitle
            title="Recent activity"
            action={
              <button className="text-link" onClick={() => navigate("/audit")}>
                Audit trail <ArrowUpRight size={14} />
              </button>
            }
          />
          {audit
            .slice(-3)
            .reverse()
            .map((e) => (
              <div className="recent-event" key={e.id}>
                <span />
                <div>
                  <strong>{e.action}</strong>
                  <small>
                    {e.actor} ·{" "}
                    {new Date(e.timestamp).toLocaleTimeString("en-GB", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </small>
                </div>
              </div>
            ))}
        </section>
      </div>
      {evidenceIds && (
        <EvidenceDialog
          ids={evidenceIds}
          onClose={() => setEvidenceIds(null)}
        />
      )}
    </>
  );
}
