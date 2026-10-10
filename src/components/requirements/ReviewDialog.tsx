import { useState } from "react";
import { Badge, Button, Modal, StatusBadge } from "../ui/Primitives";
import { useAppStore } from "../../store/useAppStore";
import type { DecisionStatus, Requirement } from "../../lib/types";
import { scoreRequirement } from "../../lib/scoring";
export function ReviewDialog({
  requirement,
  onClose,
}: {
  requirement: Requirement;
  onClose: () => void;
}) {
  const decide = useAppStore((s) => s.decide);
  const weights = useAppStore((s) => s.weights);
  const [description, setDescription] = useState(requirement.description);
  const [status, setStatus] = useState<DecisionStatus>(requirement.status);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const edited = description.trim() !== requirement.description;
  async function submit() {
    setSaving(true);
    setError("");
    try {
      await decide({
        requirementId: requirement.id,
        expectedVersion: requirement.version,
        status,
        rationale: reason,
        description,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save decision.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title="Review requirement" wide onClose={onClose}>
      <div className="flex-between">
        <span className="mono small">
          {requirement.id} / VERSION {requirement.version}
        </span>
        <StatusBadge status={requirement.status} />
      </div>
      <h3 className="review-title">{requirement.title}</h3>
      <div className="review-summary">
        <div>
          <span>Priority</span>
          <strong>
            {scoreRequirement(requirement, weights).score ?? "Unknown"}
          </strong>
        </div>
        <div>
          <span>Evidence</span>
          <strong>{requirement.evidenceLevel}</strong>
        </div>
        <div>
          <span>Impact / risk</span>
          <strong>
            {requirement.impact} / {requirement.risk}
          </strong>
        </div>
        <div>
          <span>Rough effort</span>
          <strong>{requirement.effort}</strong>
        </div>
      </div>
      <label className="field-label" htmlFor="requirement-description">
        Customer-facing requirement
      </label>
      <textarea
        id="requirement-description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
      />
      {edited && (
        <div className="notice amber">
          <p>
            Saving this edit creates version {requirement.version + 1} and
            returns it to Pending review. Approval must be made separately on
            the new version.
          </p>
        </div>
      )}
      <details className="details-panel">
        <summary>Assumptions, alternatives & version history</summary>
        <ul>
          {requirement.assumptions
            .concat(requirement.uncertainties)
            .map((t) => (
              <li key={t}>{t}</li>
            ))}
        </ul>
        <div className="alternative-grid">
          {requirement.alternatives.map((a) => (
            <div key={a.title}>
              <h4>{a.title}</h4>
              <p>
                Impact {a.impact}/5 · Risk {a.risk}/5 · {a.effort} effort
              </p>
              <small>{a.uncertainty}</small>
            </div>
          ))}
        </div>
        {requirement.history.length ? (
          requirement.history.map((v, i) => (
            <p key={i} className="small">
              v{v.version} · {v.status} · {v.rationale}
            </p>
          ))
        ) : (
          <p className="small muted">This is the first requirement version.</p>
        )}
      </details>
      <label className="field-label" htmlFor="review-action">
        Your decision
      </label>
      <select
        id="review-action"
        value={status}
        disabled={edited}
        onChange={(e) => setStatus(e.target.value as DecisionStatus)}
      >
        {(
          [
            "Pending review",
            "Approved",
            "Rejected",
            "Challenged",
            "Deferred",
            "Evidence requested",
          ] as DecisionStatus[]
        ).map((s) => (
          <option key={s} value={s}>
            {s === "Pending review" ? "Reopen / keep in review" : s}
          </option>
        ))}
      </select>
      <label className="field-label" htmlFor="decision-reason">
        Decision rationale <span className="muted">(required)</span>
      </label>
      <textarea
        id="decision-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
        placeholder="Explain your decision, uncertainties to resolve, or evidence to request…"
      />
      <div className="notice">
        <p>
          <Badge tone="amber">DEMO</Badge> All supporting evidence is synthetic.
          An approval here is a recorded prototype decision.
        </p>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={saving || !reason.trim() || !description.trim()}
          onClick={submit}
        >
          {saving
            ? "Recording…"
            : edited
              ? "Save new version"
              : "Record decision"}
        </Button>
      </div>
    </Modal>
  );
}
