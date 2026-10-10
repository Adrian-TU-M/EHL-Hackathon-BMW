import type { Scope } from "../types";
import type {
  ModeratorControl,
  ModeratorExport,
  ModeratorSession,
  SourceEvidence,
  SourceRecord,
} from "./contracts";
const root = "/api/moderator";
export async function request<T>(
  path: string,
  body?: unknown,
  method = "POST",
): Promise<T> {
  const response = await fetch(
    root + path,
    body === undefined
      ? undefined
      : {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(
      typeof error?.detail === "string"
        ? error.detail
        : `Moderator request failed (${response.status})`,
    );
  }
  return response.json();
}
export const moderatorApi = {
  prepare: (scope: Scope, parent_session_id?: string) =>
    request<ModeratorSession>("/agendas", { scope, parent_session_id }),
  session: (id: string) => request<ModeratorSession>(`/sessions/${id}`),
  confirm: (
    s: ModeratorSession,
    selected_ids: string[],
    pinned_ids: string[],
  ) =>
    request<ModeratorSession>(`/sessions/${s.id}/confirm`, {
      expected_version: s.agenda.version,
      selected_ids,
      pinned_ids,
    }),
  control: (
    s: ModeratorSession,
    action: ModeratorControl,
    rationale = "",
    topic_ids: string[] = [],
  ) =>
    request<ModeratorSession>(`/sessions/${s.id}/controls`, {
      action,
      rationale,
      topic_ids,
      expected_revision: s.revision,
      expected_topic_id: s.work?.brief.topic_id,
      idempotency_key: crypto.randomUUID(),
    }),
  evidence: (id: string, snapshot?: string) =>
    request<SourceEvidence>(
      `/evidence/${encodeURIComponent(id)}${snapshot ? `?source_snapshot=${snapshot}` : ""}`,
    ),
  external: (body: Record<string, unknown>) =>
    request<{ message: string; source_snapshot: string }>(
      "/sources/external",
      body,
    ),
  inventory: () =>
    request<{
      sources: SourceRecord[];
      warnings: string[];
      snapshot_hash: string;
    }>("/inventory"),
  export: (id: string) => request<ModeratorExport>(`/sessions/${id}/export`),
  review: (
    s: ModeratorSession,
    tid: string,
    expected_version: number,
    status: string,
    rationale: string,
  ) =>
    request<ModeratorSession>(`/sessions/${s.id}/outcomes/${tid}/review`, {
      expected_version,
      status,
      rationale,
    }),
  assumption: (
    s: ModeratorSession,
    id: string,
    expected_version: number,
    statement: string,
    status: string,
    rationale: string,
  ) =>
    request<ModeratorSession>(
      `/sessions/${s.id}/assumptions/${encodeURIComponent(id)}`,
      { expected_version, statement, status, rationale },
      "PATCH",
    ),
};
export function downloadRecords(records: ModeratorExport) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(records, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `moderator-${records.session.run_id}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
