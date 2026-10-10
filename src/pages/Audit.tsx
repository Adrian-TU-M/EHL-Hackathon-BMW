import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, ArrowUpRight, Clock3, FileText } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { Badge, PageHeader, EmptyState } from "../components/ui/Primitives";
import { EvidenceDialog } from "../components/dashboard/EvidenceDialog";
import { useModeratorStore } from "../store/useModeratorStore";
import { SourceCards } from "../components/council/ModeratorReview";
export default function Audit() {
  const audit = useAppStore((s) => s.audit);
  const moderator = useModeratorStore();
  const [moderatorIds, setModeratorIds] = useState<string[] | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All activity");
  const [order, setOrder] = useState("Newest first");
  const [ids, setIds] = useState<string[] | null>(null);
  const navigate = useNavigate();
  const events = audit.filter(
    (e) =>
      (category === "All activity" || e.category === category) &&
      `${e.action} ${e.actor} ${e.rationale} ${e.requirementId ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  if (order === "Newest first") events.reverse();
  return (
    <>
      <PageHeader
        eyebrow="TRANSPARENCY / BY DESIGN"
        title="Every decision has a story."
        description="Follow the evidence, the conversations, and the human perspective behind each change."
      />
      <div className="audit-summary">
        <Clock3 size={23} />
        <div>
          <strong>{audit.length} recorded events</strong>
          <span>
            Source → Finding → Requirement → Priority → Human decision
          </span>
        </div>
        <Badge tone="blue">LOCAL DEMO HISTORY</Badge>
      </div>
      {moderator.session && (
        <section className="moderator-section">
          <h2>Persisted moderator event history</h2>
          <p>
            Run {moderator.session.run_id} · source snapshot{" "}
            {moderator.session.agenda.source_snapshot}. The demo history below
            is separate.
          </p>
          <details>
            <summary>
              Inspect ordered server events ({moderator.events.length})
            </summary>
            {moderator.events.map((e) => (
              <article key={e.id} className="moderator-record">
                <strong>
                  #{e.sequence} · {e.actor} / {e.stage}
                </strong>
                <p>{e.statement}</p>
                <small>
                  {e.timestamp} · {e.topic_id || "Session"}
                </small>
                {!!e.evidence_ids.length && (
                  <button
                    className="text-link"
                    onClick={() => setModeratorIds(e.evidence_ids)}
                  >
                    Inspect frozen sources
                  </button>
                )}
                <pre>
                  {JSON.stringify(
                    {
                      assumption_versions: e.assumption_versions,
                      data: e.data,
                    },
                    null,
                    2,
                  )}
                </pre>
              </article>
            ))}
          </details>
        </section>
      )}
      {moderatorIds && (
        <SourceCards ids={moderatorIds} onClose={() => setModeratorIds(null)} />
      )}
      <div className="filter-bar">
        <div className="search-field">
          <Search size={16} />
          <input
            aria-label="Search audit trail"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search actions, actors, requirements…"
          />
        </div>
        <select
          aria-label="Audit category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {[
            "All activity",
            "Scope",
            "Council",
            "Decision",
            "Evidence",
            "Scoring",
          ].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <select
          aria-label="Audit order"
          value={order}
          onChange={(e) => setOrder(e.target.value)}
        >
          <option>Newest first</option>
          <option>Oldest first</option>
        </select>
      </div>
      <div className="timeline">
        {events.map((event) => (
          <article className="audit-event" key={event.id}>
            <div className="timeline-marker">
              <span className={event.actor === "PM" ? "human" : ""} />
            </div>
            <div className="audit-event-content">
              <div className="flex-between">
                <div className="flex">
                  <Badge tone={event.actor === "PM" ? "blue" : "neutral"}>
                    {event.actor === "PM" ? "Human · PM" : event.actor}
                  </Badge>
                  <span className="small muted">{event.category}</span>
                </div>
                <time dateTime={event.timestamp}>
                  {new Date(event.timestamp).toLocaleString("en-GB", {
                    dateStyle: "medium",
                    timeStyle: "medium",
                  })}
                </time>
              </div>
              <h3>{event.action}</h3>
              <p>{event.rationale}</p>
              {(event.before || event.after) && (
                <details className="audit-diff">
                  <summary>Inspect recorded change</summary>
                  <div>
                    {event.before && (
                      <section>
                        <span>BEFORE</span>
                        <pre>{event.before}</pre>
                      </section>
                    )}
                    {event.after && (
                      <section>
                        <span>AFTER</span>
                        <pre>{event.after}</pre>
                      </section>
                    )}
                  </div>
                </details>
              )}
              <div className="audit-links">
                {event.requirementId && (
                  <button
                    className="text-link"
                    onClick={() => navigate("/decisions")}
                  >
                    {event.requirementId} · v{event.version}
                    <ArrowUpRight size={14} />
                  </button>
                )}
                {event.evidenceIds.length > 0 && (
                  <button
                    className="text-link"
                    onClick={() => setIds(event.evidenceIds)}
                  >
                    <FileText size={13} />
                    {event.evidenceIds.length} source references
                  </button>
                )}
                <span className="mono small muted">{event.id.slice(0, 8)}</span>
              </div>
            </div>
          </article>
        ))}
        {!events.length && (
          <EmptyState
            title="No matching events"
            detail="Your recorded activity will appear here as the analysis progresses."
          />
        )}
      </div>
      <p className="chart-note">
        The demo history is stored in this browser. Moderator events above are
        checkpointed in the local backend. Production access control and an
        immutable enterprise audit database remain integration tasks.
      </p>
      {ids && <EvidenceDialog ids={ids} onClose={() => setIds(null)} />}
    </>
  );
}
