import type { AuditEvent } from "../types";
export function auditEvent(
  event: Omit<AuditEvent, "id" | "timestamp">,
): AuditEvent {
  return {
    ...event,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  };
}
