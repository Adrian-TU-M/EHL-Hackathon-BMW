import { useState } from "react";
import { FileText, ShieldCheck, AlertCircle } from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { Badge, Button, Modal, EmptyState } from "../ui/Primitives";
export function EvidenceDialog({
  ids,
  onClose,
  extraEvidence,
}: {
  ids: string[];
  onClose: () => void;
  extraEvidence?: { id: string; source: string; location: string; passage: string; provenance: string; source_url?: string | null; published_at?: string }[];
}) {
  const evidence = useAppStore((s) => s.evidence);
  const exclude = useAppStore((s) => s.excludeEvidence);
  const [selected, setSelected] = useState(ids[0]);
  const [reason, setReason] = useState("");
  const [excluding, setExcluding] = useState(false);
  const items = evidence.filter((e) => ids.includes(e.id)),
    item = items.find((e) => e.id === selected) ?? items[0];
  const attached = extraEvidence?.filter(e => ids.includes(e.id) && !evidence.some(local => local.id === e.id)) ?? [];
  return (
    <Modal title="Evidence explorer" wide onClose={onClose}>
      {attached.map(e => (
        <article className="judge-feature" key={e.id}>
          <Badge>{e.provenance.toUpperCase()}</Badge><h3>{e.id} · {e.source}</h3><p>{e.location} · {e.published_at ?? "Date not supplied"}</p>
          {e.source_url && /^https?:\/\//.test(e.source_url) && <a href={e.source_url} target="_blank" rel="noreferrer">Open original source</a>}
          <blockquote>{e.passage}</blockquote><p className="small">Attached by the moderator. Challenge this source through the PM council chat.</p>
        </article>
      ))}
      <div className="evidence-layout">
        <div className="evidence-index">
          {items.map((e) => (
            <button
              key={e.id}
              className={item?.id === e.id ? "selected" : ""}
              onClick={() => {
                setSelected(e.id);
                setExcluding(false);
                setReason("");
              }}
            >
              <FileText size={16} />
              <span>
                <strong>{e.id}</strong>
                <small>
                  {e.domain} · {e.category}
                </small>
              </span>
            </button>
          ))}
        </div>
        {item ? (
          <div className="evidence-detail">
            <div className="flex-between">
              <Badge tone="amber">{item.provenance === "synthetic" ? "SYNTHETIC DEMO" : item.provenance.toUpperCase() + " SOURCE"}</Badge>
              <span className="muted small">{item.publishedAt}</span>
            </div>
            <h3>{item.source}</h3>
            <div className="source-location">{item.location}</div>
            {item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer">Open original source</a>}
            <blockquote>“{item.passage}”</blockquote>
            <dl className="metadata-grid">
              <div>
                <dt>Scope</dt>
                <dd>
                  {item.vehicle} · {item.market}
                </dd>
              </div>
              <div>
                <dt>Powertrain</dt>
                <dd>{item.powertrain}</dd>
              </div>
              <div>
                <dt>Classification</dt>
                <dd>
                  {item.type} / {item.category}
                </dd>
              </div>
              <div>
                <dt>Provenance</dt>
                <dd>{item.provenance === "synthetic" ? "Hand-authored demonstration fixture" : "Supplied source passage; authenticity requires verification"}</dd>
              </div>
              <div>
                <dt>Observation unit</dt>
                <dd>
                  {item.provenance !== "synthetic" ? "Supplied source passage" : item.domain === "customer"
                    ? "One synthetic feedback record"
                    : "One hypothetical scenario note"}
                </dd>
              </div>
              <div>
                <dt>Population / sample size</dt>
                <dd>{item.provenance === "synthetic" ? "Unknown / no real respondents" : "Not established by this passage"}</dd>
              </div>
            </dl>
            {item.quantitative && (
              <p>
                {item.quantitative.numerator} / {item.quantitative.denominator}{" "}
                {item.quantitative.unit}. Method: {item.quantitative.method}.{" "}
                {item.quantitative.limitations}
              </p>
            )}
            <div className="notice">
              <AlertCircle size={17} />
              <p>
                This is not a passage from a supplied BMW file or verified
                external research. Fixture frequency does not measure customer
                prevalence.
              </p>
            </div>
            {item.exclusionReason ? (
              <div className="notice amber">
                <ShieldCheck size={17} />
                <p>
                  <strong>Excluded from active support.</strong>{" "}
                  {item.exclusionReason}
                </p>
              </div>
            ) : excluding ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  exclude(item.id, reason);
                  setExcluding(false);
                }}
              >
                <label className="field-label" htmlFor="exclusion-reason">
                  Why should this evidence be excluded?
                </label>
                <textarea
                  id="exclusion-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Describe the relevance or quality concern…"
                  required
                />
                <p className="small muted">
                  Linked requirements will receive a new version and return to
                  review.
                </p>
                <Button type="submit" disabled={!reason.trim()}>
                  Exclude and record rationale
                </Button>
              </form>
            ) : (
              <Button variant="secondary" onClick={() => setExcluding(true)}>
                Challenge / exclude this evidence
              </Button>
            )}
          </div>
        ) : attached.length ? null : (
          <EmptyState
            title="No evidence available"
            detail="No source references were attached to this item."
          />
        )}
      </div>
    </Modal>
  );
}
