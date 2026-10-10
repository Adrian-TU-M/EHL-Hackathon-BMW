import { useEffect, useState } from "react";
export function useMotion() {
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [visible, setVisible] = useState(!document.hidden);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(q.matches);
    const visibility = () => setVisible(!document.hidden);
    q.addEventListener("change", change);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      q.removeEventListener("change", change);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  return { reduced, visible };
}
