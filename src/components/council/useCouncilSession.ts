import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { moderatorApi } from "../../lib/council/api";
import { useModeratorStore } from "../../store/useModeratorStore";

/** The council and portfolio always open the same server-owned session. */
export function useCouncilSession() {
  const [params] = useSearchParams();
  const requested = params.get("session");
  const state = useModeratorStore();
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    const id = requested || state.id;
    if (!id || state.session?.id === id) return;
    let cancelled = false;
    setLoadError("");
    moderatorApi
      .session(id)
      .then((session) => {
        if (!cancelled) state.accept(session);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [requested, state.id, state.session?.id, state.accept]);
  const loading = !!requested && state.session?.id !== requested;
  return {
    ...state,
    session: loading ? undefined : state.session,
    loading,
    loadError,
  };
}
