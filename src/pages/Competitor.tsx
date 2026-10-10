import { useState } from "react";
import {
  ArrowUpRight,
  Check,
  Minus,
  ScanLine,
  SlidersHorizontal,
} from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { Badge, PageHeader, SectionTitle } from "../components/ui/Primitives";
import { EvidenceDialog } from "../components/dashboard/EvidenceDialog";
export default function Competitor() {
  const { evidence, requirements, scope } = useAppStore();
  const [segment, setSegment] = useState("Executive");
  const [ids, setIds] = useState<string[] | null>(null);
  const [gapOnly, setGapOnly] = useState(false);
  const sources = evidence.filter((e) => e.domain === "competitor");
  const rows = requirements
    .map((r, i) => ({
      requirement: r,
      peerA: i % 3 !== 1,
      peerB: i % 2 === 0,
      source: sources.find((e) => e.category === r.topic),
    }))
    .filter((r) => !gapOnly || r.peerA || r.peerB);
  return (
    <>
      <PageHeader
        eyebrow="03 / THE COMPETITIVE PERSPECTIVE"
        title="Find the space to lead."
        description="Understand experience gaps. Look beyond feature parity."
      />
      <div className="comparison-context">
        <span>
          <ScanLine size={18} /> Comparison context{" "}
          <strong>
            {scope.market} · {scope.powertrain}
          </strong>
        </span>
        <label>
          Illustrative segment{" "}
          <select
            aria-label="Comparator segment"
            value={segment}
            onChange={(e) => setSegment(e.target.value)}
          >
            {["Compact", "Executive", "Luxury"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="competitor-grid">
        {[
          {
            name: `BMW ${scope.vehicle}`,
            sub: "Your next-generation scope",
            className: "bmw",
            tag: "FOCUS VEHICLE",
          },
          {
            name: `Reference ${segment} A`,
            sub: "Hypothetical digital-first peer",
            className: "peer-a",
            tag: "DEMO COMPARATOR",
          },
          {
            name: `Reference ${segment} B`,
            sub: "Hypothetical comfort-focused peer",
            className: "peer-b",
            tag: "DEMO COMPARATOR",
          },
        ].map((v, i) => (
          <div key={v.name} className={`competitor-card ${v.className}`}>
            <div className="flex-between">
              <Badge tone={i === 0 ? "blue" : "neutral"}>{v.tag}</Badge>
              <span className="mono small">0{i + 1}</span>
            </div>
            <div className="car-silhouette" aria-hidden="true">
              <span />
              <i />
              <i />
            </div>
            <h2>{v.name}</h2>
            <p>{v.sub}</p>
            <span className="small muted">
              {i === 0
                ? "Equipment baseline not connected"
                : "No real-world specifications asserted"}
            </span>
          </div>
        ))}
      </div>
      <section className="panel panel-padding">
        <SectionTitle
          title="An experience-level comparison"
          detail="Illustrative availability patterns · actual model, trim and equipment need verification"
          action={
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={gapOnly}
                onChange={(e) => setGapOnly(e.target.checked)}
              />
              <SlidersHorizontal size={14} /> Potential gaps only
            </label>
          }
        />
        <div className="table-scroll">
          <table className="comparison-table">
            <thead>
              <tr>
                <th>Customer experience</th>
                <th>Current BMW baseline</th>
                <th>Reference A</th>
                <th>Reference B</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ requirement: r, peerA, peerB, source }) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.topic}</strong>
                    <span>{r.title}</span>
                  </td>
                  <td>
                    <Badge>Unknown</Badge>
                  </td>
                  <td>
                    {peerA ? (
                      <span className="comparison-yes">
                        <Check size={16} /> Illustrative strength
                      </span>
                    ) : (
                      <span className="muted">
                        <Minus size={13} /> Not assessed
                      </span>
                    )}
                  </td>
                  <td>
                    {peerB ? (
                      <span className="comparison-yes">
                        <Check size={16} /> Illustrative strength
                      </span>
                    ) : (
                      <span className="muted">
                        <Minus size={13} /> Not assessed
                      </span>
                    )}
                  </td>
                  <td>
                    <button
                      className="icon-button"
                      aria-label={`Inspect ${r.topic} comparison source`}
                      onClick={() => source && setIds([source.id])}
                    >
                      <ArrowUpRight size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="insight-strip">
        <ScanLine size={24} />
        <div>
          <strong>Opportunity starts with a fair comparison.</strong>
          <p>
            These peers are intentionally unnamed. Connect dated public sources
            for equivalent vehicles, markets, trims and availability before
            concluding that BMW has a competitive gap.
          </p>
        </div>
        <Badge tone="amber">VERIFICATION NEEDED</Badge>
      </div>
      {ids && <EvidenceDialog ids={ids} onClose={() => setIds(null)} />}
    </>
  );
}
