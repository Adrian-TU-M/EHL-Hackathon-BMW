import type { ClientTools } from "@elevenlabs/react";
import type { Audience, Presentation, SlideSpec } from "./contracts";
import { presentationApi } from "./api";

export interface PresentationVoiceContext {
  presentation: Presentation;
  audience: Audience;
  slide?: SlideSpec;
  persona?: string;
  onAccept: (p: Presentation) => void;
  onNavigate: (index: number) => void;
}

export function activeVoiceRehearsal(
  p: Presentation,
  audience: Audience,
  persona?: string,
) {
  if (!persona) return undefined;
  return [...p.rehearsals]
    .reverse()
    .find(
      (r) =>
        r.persona === persona &&
        r.audience === audience &&
        r.deck_revision === p.revision,
    );
}

export function presentationClientTools(
  current: () => PresentationVoiceContext,
): ClientTools {
  return {
    get_presentation_context: () => {
      const {
        presentation: p,
        audience: a,
        slide: s,
        persona: role,
      } = current();
      return JSON.stringify({
        revision: p.revision,
        audience: a,
        mode: role ? "rehearsal" : "editing",
        persona: role,
        brief: p.brief,
        slide: s,
        slides: p.decks[a]?.slides.map((item, index) => ({
          number: index + 1,
          id: item.id,
          title: item.title,
          locked: item.locked,
        })),
        evidence: p.snapshot.evidence.filter((e) =>
          s?.evidence_ids.includes(e.id),
        ),
        business_case: p.business_case,
        decisions: p.snapshot.decisions.map((d) => ({
          id: d.id,
          title: d.title,
          description: d.description,
          pm_rationale: d.pm_rationale,
          uncertainties: d.uncertainties,
        })),
        rehearsal: activeVoiceRehearsal(p, a, role),
        synthetic: p.snapshot.synthetic,
      });
    },
    show_slide: (parameters) => {
      const index = Number(parameters.slide_number) - 1;
      const state = current();
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= (state.presentation.decks[state.audience]?.slides.length || 0)
      )
        return "Invalid slide number";
      state.onNavigate(index);
      return "Slide opened";
    },
    request_revision: async (parameters) => {
      const state = current();
      const instruction = String(parameters.instruction || "").trim();
      const id =
        typeof parameters.slide_id === "string"
          ? parameters.slide_id
          : state.slide?.id;
      if (!instruction || !id)
        return "Select a slide and supply the requested change";
      if (state.persona)
        return "Rehearsal is read-only. Switch to slide editing to request a change.";
      try {
        const p = await presentationApi.revise(
          state.presentation,
          state.audience,
          id,
          instruction,
        );
        state.onAccept(p);
        return "Revision request queued. The PM must review and apply the resulting proposal. The deck has not changed.";
      } catch (e) {
        return String(e);
      }
    },
    submit_rehearsal_answer: async (parameters) => {
      const state = current(),
        rehearsal = activeVoiceRehearsal(
          state.presentation,
          state.audience,
          state.persona,
        );
      if (!state.persona || !rehearsal || rehearsal.complete)
        return "Start a rehearsal in the studio first";
      const answer = String(parameters.answer || "").trim();
      if (!answer) return "An answer is required";
      try {
        const p = await presentationApi.answer(
          state.presentation,
          rehearsal.id,
          answer,
        );
        state.onAccept(p);
        return JSON.stringify(p.rehearsals.at(-1));
      } catch (e) {
        return String(e);
      }
    },
  };
}
