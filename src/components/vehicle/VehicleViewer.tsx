import { vehicles } from "../../lib/vehicles";
import type { Vehicle } from "../../lib/types";
import { useAppStore } from "../../store/useAppStore";

/** Static reference photography; the external 3D car viewer has been retired. */
export default function VehicleViewer({
  compact = false,
  vehicle,
}: {
  compact?: boolean;
  vehicle?: Vehicle;
}) {
  const current = useAppStore((s) => s.scope.vehicle);
  const car = vehicles[vehicle || current];
  return (
    <div className={`vehicle-viewer real-vehicle ${compact ? "compact" : ""}`}>
      <img
        className="vehicle-photo"
        src={car.image}
        alt={`${car.name} reference vehicle`}
        fetchPriority={compact ? "auto" : "high"}
      />
      <div className="vehicle-vignette" />
    </div>
  );
}
