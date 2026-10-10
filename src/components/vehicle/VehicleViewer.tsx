import { useEffect, useState } from "react";
import { Box, ArrowUpRight, Image, Rotate3D, X } from "lucide-react";
import { vehicles } from "../../lib/vehicles";
import type { Vehicle } from "../../lib/types";
import { useAppStore } from "../../store/useAppStore";
import { useMotion } from "../ui/useMotion";

/** Public Sketchfab embeds: no extraction or redistribution of third-party meshes. */
export default function VehicleViewer({
  compact = false,
  vehicle,
}: {
  compact?: boolean;
  vehicle?: Vehicle;
}) {
  const current = useAppStore((s) => s.scope.vehicle);
  const id = vehicle || current;
  const car = vehicles[id];
  const [interactive, setInteractive] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const { reduced } = useMotion();
  useEffect(() => {
    setInteractive(false);
    setLoaded(false);
  }, [id]);
  return (
    <div
      className={`vehicle-viewer real-vehicle ${compact ? "compact" : ""} ${interactive ? "is-interactive" : ""}`}
    >
      <img
        className="vehicle-photo"
        src={car.image}
        alt={`${car.name} ${id} reference vehicle`}
        fetchPriority={compact ? "auto" : "high"}
      />
      <div className="vehicle-vignette" />
      {interactive && (
        <div className="model-embed">
          {!loaded && (
            <div className="model-loading">
              <span className="spin">
                <Rotate3D size={24} />
              </span>
              <p>Opening {car.name} in 3D…</p>
              <small>External viewer requires an internet connection.</small>
            </div>
          )}
          <iframe
            key={id}
            title={`${car.name} ${id} interactive 3D model`}
            src={`https://sketchfab.com/models/${car.modelId}/embed?autostart=1&autospin=${reduced ? 0 : 0.12}&ui_theme=dark&dnt=1`}
            allow="autoplay; fullscreen; xr-spatial-tracking"
            allowFullScreen
            onLoad={() => setLoaded(true)}
          />
          <a
            className="model-source"
            href={`https://sketchfab.com/models/${car.modelId}`}
            target="_blank"
            rel="noreferrer"
          >
            {car.modelTitle} · {car.creator} / Sketchfab{" "}
            <ArrowUpRight size={12} />
          </a>
        </div>
      )}
      <div className="vehicle-mode-controls">
        <span className="reference-label">
          <span />{" "}
          {interactive ? "INTERACTIVE EXTERIOR" : "BMW DESIGN REFERENCE"}
        </span>
        <button
          className={`viewer-switch ${interactive ? "active" : ""}`}
          onClick={() => setInteractive((v) => !v)}
        >
          {interactive ? <X size={16} /> : <Box size={16} />}
          {interactive ? "Close 3D view" : "Explore in 3D"}
        </button>
      </div>
      {!compact && !interactive && (
        <div className="vehicle-photo-note">
          <Image size={12} /> Reference photography · specification may vary
        </div>
      )}
      {interactive && (
        <p className="model-disclosure">
          Community-created BMW model. Drag to rotate · scroll to zoom. Visual
          exploration, not an engineering or driving simulation.
        </p>
      )}
    </div>
  );
}
