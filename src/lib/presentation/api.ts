import { useAppStore } from "../../store/useAppStore";
import type {
  Audience,
  OutlineItem,
  Presentation,
  PresentationBrief,
  PresentationList,
  SlideSpec,
  ThemeId,
} from "./contracts";

export function dashboardInput() {
  const s = useAppStore.getState();
  return {
    workspace_id: s.scope.confirmedAt || "dashboard-demo",
    scope: s.scope,
    requirements: s.requirements,
    evidence: s.evidence,
    findings: s.findings,
    weights: s.weights,
  };
}

export async function presentationRequest<T>(
  path: string,
  body?: unknown,
  method = "POST",
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(
      "/api/presentations" + path,
      body === undefined
        ? undefined
        : {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
    );
  } catch {
    throw new Error(
      "Presentation service unavailable. Start the unified backend with npm run dev:backend.",
    );
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(
      typeof data?.detail === "string"
        ? data.detail
        : response.status >= 500
          ? "Presentation service unavailable. Start the unified backend with npm run dev:backend."
          : `Presentation request failed (${response.status}). Check the inputs and reload.`,
    );
  }
  return response.json();
}

export const presentationApi = {
  health: () =>
    presentationRequest<{
      available: boolean;
      ollama: { available: boolean; model: string };
    }>("/health"),
  list: () => presentationRequest<PresentationList>(""),
  get: (id: string) => presentationRequest<Presentation>(`/${id}`),
  create: (
    kind: "isolated_demo" | "dashboard_demo" | "council",
    mode: "demo" | "ollama" = "ollama",
    session_id?: string,
  ) =>
    presentationRequest<Presentation>("", {
      kind,
      mode,
      session_id,
      dashboard: kind === "dashboard_demo" ? dashboardInput() : undefined,
      idempotency_key: crypto.randomUUID(),
    }),
  brief: (p: Presentation, brief: PresentationBrief) =>
    presentationRequest<Presentation>(
      `/${p.id}/brief`,
      { expected_revision: p.revision, brief },
      "PUT",
    ),
  outline: (
    p: Presentation,
    items: OutlineItem[],
    audience: Audience = p.brief.audience,
  ) =>
    presentationRequest<Presentation>(`/${p.id}/outline/approve`, {
      expected_revision: p.revision,
      items,
      audience,
    }),
  applyTheme: (
    p: Presentation,
    audience: Audience,
    theme_id: ThemeId = "bmw-cinematic-v1",
  ) =>
    presentationRequest<Presentation>(`/${p.id}/theme`, {
      expected_revision: p.revision,
      audience,
      theme_id,
    }),
  generate: (
    p: Presentation,
    operation: "outline" | "slides" | "variant",
    audience: Audience,
  ) =>
    presentationRequest<Presentation>(`/${p.id}/jobs`, {
      expected_revision: p.revision,
      operation,
      audience,
      idempotency_key: crypto.randomUUID(),
    }),
  cancel: (p: Presentation, id: string) =>
    presentationRequest<Presentation>(`/${p.id}/jobs/${id}/cancel`, {}),
  revise: (
    p: Presentation,
    audience: Audience,
    slide_id: string,
    instruction: string,
  ) =>
    presentationRequest<Presentation>(`/${p.id}/revision-proposals`, {
      expected_revision: p.revision,
      audience,
      slide_id,
      instruction,
      idempotency_key: crypto.randomUUID(),
    }),
  apply: (p: Presentation, id: string, action: "apply" | "discard") =>
    presentationRequest<Presentation>(
      `/${p.id}/revision-proposals/${id}/${action}`,
      { expected_revision: p.revision },
    ),
  edit: (p: Presentation, audience: Audience, slides: SlideSpec[]) =>
    presentationRequest<Presentation>(
      `/${p.id}/slides`,
      { expected_revision: p.revision, audience, slides },
      "PUT",
    ),
  check: (p: Presentation) =>
    presentationRequest<Presentation>(`/${p.id}/source-check`, {
      expected_revision: p.revision,
      dashboard:
        p.snapshot.kind === "dashboard_demo" ? dashboardInput() : undefined,
    }),
  refresh: (p: Presentation) =>
    presentationRequest<Presentation>(`/${p.id}/refresh`, {
      expected_revision: p.revision,
      dashboard:
        p.snapshot.kind === "dashboard_demo" ? dashboardInput() : undefined,
    }),
  finalize: (p: Presentation, acknowledgment: string) =>
    presentationRequest<Presentation>(`/${p.id}/finalize`, {
      expected_revision: p.revision,
      acknowledgment,
    }),
  export: (p: Presentation) =>
    presentationRequest<{
      presentation: Presentation;
      speaker_notes: Record<string, Record<string, string>>;
    }>(`/${p.id}/export`),
  rehearsal: (p: Presentation, persona: string, audience: Audience) =>
    presentationRequest<Presentation>(`/${p.id}/rehearsals`, {
      expected_revision: p.revision,
      persona,
      audience,
    }),
  answer: (p: Presentation, id: string, answer: string) =>
    presentationRequest<Presentation>(`/${p.id}/rehearsals/${id}/answers`, {
      answer,
    }),
  voiceMessage: (
    id: string,
    message: { id: string; role: "user" | "assistant"; text: string },
  ) =>
    presentationRequest<{ saved: boolean }>(`/${id}/voice-messages`, message),
};
