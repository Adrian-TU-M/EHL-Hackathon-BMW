import { useMemo, useState } from "react";
import {
  ConversationProvider,
} from "@elevenlabs/react";
import {
  Check,
  MessageSquareText,
  PauseCircle,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../../store/useAppStore";
import type { DecisionStatus } from "../../lib/types";
import { Badge, Button, Modal } from "../ui/Primitives";

import { JudgeConversationSession } from "./JudgeConversationSession";

const elevenLabsAgentId = import.meta.env.VITE_ELEVENLABS_AGENT_ID?.trim();

export function JudgeHandoff({ requirementId }: { requirementId: string }) {
  const navigate = useNavigate();
  const requirement = useAppStore((s) =>
    s.requirements.find((item) => item.id === requirementId),
  );
  const council = useAppStore((s) => s.council);
  const recordCouncilMessage = useAppStore((s) => s.recordCouncilMessage);
  const decide = useAppStore((s) => s.decide);
  const deferCouncilReview = useAppStore((s) => s.deferCouncilReview);
  const setCouncilHandoff = useAppStore((s) => s.setCouncilHandoff);
  const [discussionOpen, setDiscussionOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [revision, setRevision] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const hasDiscussion = council.discussion.some((message) => message.actor === "PM");

  const evidence = useAppStore((s) => s.evidence);
  const context = useMemo(() => {
    if (!requirement) return "";
    return JSON.stringify(
      {
        scope: {
          vehicle: requirement.vehicle,
          market: requirement.market,
          powertrain: requirement.powertrain,
        },
        requirement: {
          id: requirement.id,
          version: requirement.version,
          topic: requirement.topic,
          title: requirement.title,
          description: requirement.description,
          rationale: requirement.rationale,
          assumptions: requirement.assumptions,
          uncertainties: requirement.uncertainties,
          alternatives: requirement.alternatives,
          evidenceLevel: requirement.evidenceLevel,
        },
        evidence: evidence
          .filter(
            (item) =>
              requirement.evidenceIds.includes(item.id) &&
              !item.exclusionReason,
          )
          .map((item) => ({
            id: item.id,
            source: item.source,
            location: item.location,
            publishedAt: item.publishedAt,
            provenance: item.provenance,
            passage: item.passage,
            quantitative: item.quantitative,
          })),
        councilStatements: council.events
          .slice(0, council.cursor + 1)
          .map(({ stage, actor, statement, evidenceIds, assumption }) => ({
            stage,
            actor,
            statement,
            evidenceIds,
            assumption,
          })),
      },
      null,
      2,
    );
  }, [requirement, evidence, council.events, council.cursor]);

  if (!requirement) return null;

  async function commit(status: DecisionStatus, rationale: string) {
    if (!requirement) return;
    setSaving(true);
    setError("");
    try {
      await decide({
        requirementId: requirement.id,
        expectedVersion: requirement.version,
        status,
        rationale,
        description: requirement.description,
      });
      setCouncilHandoff(
        status === "Approved"
          ? "approved"
          : status === "Rejected"
            ? "rejected"
            : "pending",
      );
      setRejecting(false);
      setSavedMessage(
        status === "Approved"
          ? "Approved for this requirement version."
          : "Rejection recorded in the decision history.",
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to record decision.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function applyRevision() {
    if (!requirement || !revision.trim()) return;
    if (revision.trim() === requirement.description.trim()) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await decide({
        requirementId: requirement.id,
        expectedVersion: requirement.version,
        status: "Pending review",
        rationale: "PM revised the requirement after discussing it with the Judge.",
        description: revision.trim(),
      });
      setEditing(false);
      setSavedMessage(`Revision saved as version ${requirement.version + 1}.`);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to save revision.",
      );
    } finally {
      setSaving(false);
    }
  }

  function reviewLater() {
    deferCouncilReview();
    navigate("/decisions?demo=1");
  }

  return (
    <section className="judge-handoff">
      <div className="judge-handoff-heading">
        <div>
          <div className="eyebrow">JUDGE TO PM</div>
          <h2>Your council recommendation</h2>
          <p>
            The discussion is complete. The Judge is ready to explain the
            recommendation or hear your feedback.
          </p>
        </div>
        <Badge tone="amber">PROVISIONAL · VERSION {requirement.version}</Badge>
      </div>

      <div className="judge-recommendation">
        <span className="mono">{requirement.id} / {requirement.topic}</span>
        <p>{requirement.description}</p>
        <small>
          Judge’s rationale: {requirement.rationale} Evidence: {requirement.evidenceLevel}.
        </small>
      </div>

      {savedMessage && <div className="notice green"><p>{savedMessage}</p></div>}
      {error && <p className="error" role="alert">{error}</p>}

      {council.handoff === "approved" || council.handoff === "rejected" ? (
        <div className="judge-handoff-result">
          <Badge tone={council.handoff === "approved" ? "green" : "amber"}>
            {council.handoff === "approved" ? "APPROVED" : "REJECTED"}
          </Badge>
          <span>
            This decision is recorded for version {requirement.version}. You can
            revisit it later in Decisions.
          </span>
          <Button variant="secondary" onClick={() => navigate("/decisions?demo=1")}>
            Open decisions
          </Button>
        </div>
      ) : council.handoff === "review_later" ? (
        <div className="judge-handoff-result">
          <Badge tone="dark">REVIEW LATER</Badge>
          <span>The recommendation is waiting in your review queue.</span>
          <Button variant="secondary" onClick={() => navigate("/decisions?demo=1")}>
            Open review queue
          </Button>
        </div>
      ) : (
        <>
          {editing && (
            <div className="judge-revision-editor">
              <label className="field-label" htmlFor="judge-revision">
                Revised customer-facing requirement
              </label>
              <textarea
                id="judge-revision"
                rows={3}
                value={revision}
                onChange={(event) => setRevision(event.target.value)}
              />
              <div className="inline-actions">
                <Button
                  disabled={saving || !revision.trim()}
                  onClick={() => void applyRevision()}
                >
                  Save as new version
                </Button>
                <Button variant="secondary" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {rejecting && (
            <div className="judge-revision-editor">
              <label className="field-label" htmlFor="judge-rejection-reason">
                Why are you rejecting this recommendation?
              </label>
              <textarea
                id="judge-rejection-reason"
                rows={2}
                value={rejectionReason}
                onChange={(event) => setRejectionReason(event.target.value)}
                placeholder="Record your reason for the decision…"
              />
              <div className="inline-actions">
                <Button
                  disabled={saving || !rejectionReason.trim()}
                  onClick={() => void commit("Rejected", rejectionReason)}
                >
                  Confirm rejection
                </Button>
                <Button variant="secondary" onClick={() => setRejecting(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <div className="judge-handoff-actions">
            <Button
              disabled={saving}
              onClick={() => void commit("Approved", "Approved as presented by the Judge.")}
            >
              <Check size={15} /> Approve now
            </Button>
            <Button variant="secondary" onClick={reviewLater}>
              <PauseCircle size={15} /> Review later
            </Button>
            <Button variant="secondary" onClick={() => setDiscussionOpen(true)}>
              <MessageSquareText size={15} /> Discuss with Judge
            </Button>
            {hasDiscussion && !editing && !rejecting && (
              <>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setRevision(requirement.description);
                    setEditing(true);
                  }}
                >
                  Revise wording
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setRejecting(true)}
                >
                  Reject recommendation
                </Button>
              </>
            )}
          </div>
        </>
      )}

      {discussionOpen && (
        <Modal
          title="Discuss with the Judge"
          wide
          onClose={() => setDiscussionOpen(false)}
        >
          {!elevenLabsAgentId ? (
            <div className="notice amber">
              <p>
                Live discussion is not configured. Add
                <code> VITE_ELEVENLABS_AGENT_ID </code> to your local
                environment to enable text and voice.
              </p>
            </div>
          ) : (
            <ConversationProvider key={council.run}>
              <JudgeConversationSession
                context={context}
                run={council.run}
                agentId={elevenLabsAgentId}
                messages={council.discussion}
                onMessage={recordCouncilMessage}
              />
            </ConversationProvider>
          )}
          <div className="inline-actions judge-dialog-footer">
            {hasDiscussion && (
              <Button
                variant="secondary"
                onClick={() => {
                  setRevision(requirement.description);
                  setDiscussionOpen(false);
                  setEditing(true);
                }}
              >
                Use feedback to revise
              </Button>
            )}
            <Button variant="secondary" onClick={() => setDiscussionOpen(false)}>
              <X size={14} /> Close discussion
            </Button>
          </div>
        </Modal>
      )}
    </section>
  );
}
