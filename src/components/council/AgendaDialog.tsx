import { useState } from "react";
import { Check, Play, Search } from "lucide-react";
import { Button, Modal } from "../ui/Primitives";
import type { ModeratorSession } from "../../lib/council/contracts";

export function AgendaDialog({
  session,
  busy,
  error,
  onClose,
  onStart,
}: {
  session?: ModeratorSession;
  busy: boolean;
  error?: string;
  onClose: () => void;
  onStart: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>(
    () => session?.agenda.selected_ids || [],
  );
  const [query, setQuery] = useState("");
  const frozen = !!session?.agenda.confirmed_at;
  const topics =
    session?.agenda.topics.filter(
      (t) =>
        t.eligible && (!frozen || session.agenda.selected_ids.includes(t.id)),
    ) || [];
  const visible = topics.filter((t) =>
    `${t.label} ${t.area}`.toLowerCase().includes(query.toLowerCase()),
  );
  const chosen = frozen ? session!.agenda.selected_ids : selected;
  return (
    <Modal
      title={frozen ? "Your debate agenda" : "What should we explore?"}
      onClose={onClose}
      wide
    >
      <div className="council-agenda-dialog">
        <p className="agenda-intro">
          {session
            ? `${session.agenda.scope.vehicle} · ${session.agenda.scope.market}`
            : "Reading the car’s evidence…"}
        </p>
        <p>
          {frozen
            ? "The council follows this confirmed selection. Start a new council to choose a different agenda."
            : "Moderator has found these evidence-backed topics. Choose what matters; the agents will debate each one before Jury drafts a requirement."}
        </p>
        {error && (
          <p role="alert" className="vc-error">
            {error}
          </p>
        )}
        {session && (
          <>
            <div className="agenda-toolbar">
              <label>
                <Search size={16} />
                <input
                  aria-label="Find a topic"
                  placeholder="Find a topic"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <span>{chosen.length} selected</span>
            </div>
            {!frozen && (
              <div className="agenda-shortcuts">
                <button
                  className="text-link"
                  onClick={() => setSelected(topics.map((t) => t.id))}
                >
                  Select all {topics.length}
                </button>
                <button className="text-link" onClick={() => setSelected([])}>
                  Clear selection
                </button>
              </div>
            )}
            <div className="agenda-topic-list">
              {visible.map((t) => (
                <label
                  key={t.id}
                  className={`agenda-topic ${chosen.includes(t.id) ? "selected" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={chosen.includes(t.id)}
                    disabled={frozen || busy}
                    onChange={(e) =>
                      setSelected((previous) =>
                        e.target.checked
                          ? [...previous, t.id]
                          : previous.filter((id) => id !== t.id),
                      )
                    }
                  />
                  <div>
                    <strong>{t.label}</strong>
                    <p>{t.question}</p>
                    <small>
                      {t.evidence_ids.length} source references
                      {t.exploratory ? " · exploratory" : ""}
                    </small>
                  </div>
                  {frozen &&
                    session.outcomes.some((o) => o.topic_id === t.id) && (
                      <Check size={18} />
                    )}
                </label>
              ))}
            </div>
            <footer className="agenda-dialog-footer">
              <small>
                {frozen
                  ? "Sources and decisions remain attached to this agenda."
                  : "Each topic includes proposals, challenges, responses and a Jury assessment. Local Qwen can take several minutes per topic."}
              </small>
              {frozen ? (
                <Button onClick={onClose}>Back to council</Button>
              ) : (
                <Button
                  disabled={busy || !chosen.length}
                  onClick={() => onStart(chosen)}
                >
                  <Play size={15} />
                  {busy
                    ? "Starting…"
                    : `Start debate · ${chosen.length} topic${chosen.length === 1 ? "" : "s"}`}
                </Button>
              )}
            </footer>
          </>
        )}
      </div>
    </Modal>
  );
}
