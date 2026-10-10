import { useEffect, useState } from "react";
import { NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  TrendingUp,
  ScanLine,
  Orbit,
  SlidersHorizontal,
  History,
  ArrowUpRight,
  Download,
  Menu,
  X,
  ArrowLeft,
  Info,
  Check,
} from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { vehicleNames } from "../../lib/mock-data";
import { Badge, Button } from "../ui/Primitives";
const navigation = [
  { to: "/overview", label: "Overview", icon: LayoutDashboard },
  { to: "/customer", label: "Customer intelligence", icon: Users },
  { to: "/market", label: "Market trends", icon: TrendingUp },
  { to: "/competitor", label: "Competitor intelligence", icon: ScanLine },
  { to: "/council", label: "Agent council", icon: Orbit },
  { to: "/decisions", label: "Decisions & scenarios", icon: SlidersHorizontal },
  { to: "/audit", label: "Audit trail", icon: History },
];
export default function AppShell() {
  const started = useAppStore((s) => s.started);
  const scope = useAppStore((s) => s.scope);
  const status = useAppStore((s) => s.council.status);
  const tick = useAppStore((s) => s.tickCouncil);
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState("");
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    if (status !== "running") return;
    const timer = setInterval(tick, 4200);
    return () => clearInterval(timer);
  }, [status, tick]);
  useEffect(() => {
    setOpen(false);
    window.scrollTo(0, 0);
  }, [location.pathname]);
  useEffect(() => {
    const fn = () => setStorageError(true);
    window.addEventListener("bmw-storage-error", fn);
    return () => window.removeEventListener("bmw-storage-error", fn);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  async function exportReport() {
    setExporting(true);
    try {
      const { downloadReport } = await import("../../lib/export/report");
      await downloadReport(useAppStore.getState());
      setToast("Your product intelligence report has been downloaded.");
    } catch {
      setToast("The report could not be generated. Please try again.");
    } finally {
      setExporting(false);
    }
  }
  if (!started) return <Navigate to="/" replace />;
  return (
    <div
      className={`app-shell ${location.pathname === "/council" ? "council-shell" : ""}`}
    >
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <NavLink to="/" className="brand">
          <span className="brand-word">BMW</span>
          <span className="brand-divider" />
          <span className="brand-next">
            NEXT<span className="brand-dot">.</span>
          </span>
        </NavLink>
        <div className="workspace-label">INTELLIGENCE WORKSPACE</div>
        <nav aria-label="Main navigation">
          {navigation.map(({ to, label, icon: Icon }, i) => (
            <NavLink key={to} to={to}>
              <Icon size={18} />
              <span>{label}</span>
              {i === 4 && <span className="nav-dot" />}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="session-card">
            <span className="session-dot" />
            <div>
              <strong>Demo environment</strong>
              <span>Local session · synthetic data</span>
            </div>
          </div>
          <p>
            AI analyzes.
            <br />
            Humans decide.
          </p>
          <NavLink to="/">
            <ArrowLeft size={15} /> Analysis setup <ArrowUpRight size={14} />
          </NavLink>
          <small>UNOFFICIAL HACKATHON CONCEPT</small>
        </div>
      </aside>
      {open && (
        <button
          aria-label="Close navigation"
          className="sidebar-backdrop"
          onClick={() => setOpen(false)}
        />
      )}
      <div className="workspace">
        <header className="workspace-topbar">
          <div>
            <button
              className="icon-button mobile-menu"
              aria-label={open ? "Close navigation" : "Open navigation"}
              onClick={() => setOpen(!open)}
            >
              {open ? <X size={20} /> : <Menu size={20} />}
            </button>
            <span className="topbar-vehicle">
              BMW {vehicleNames[scope.vehicle]} <span>/{scope.vehicle}</span>
            </span>
            <span className="topbar-divider" />
            <span className="context-label">
              {scope.market} <span>·</span> {2026 + scope.horizon} outlook
            </span>
          </div>
          <div>
            <Badge tone="blue">DEMO</Badge>
            <Button
              variant="secondary"
              className="export-button"
              disabled={exporting}
              onClick={exportReport}
            >
              <Download size={15} />
              {exporting ? "Exporting…" : "Export report"}
            </Button>
            <div className="profile" aria-label="Product manager">
              PM
            </div>
          </div>
        </header>
        {storageError && (
          <div className="storage-notice" role="alert">
            <Info size={16} /> Browser storage is unavailable. Changes are kept
            in memory until this tab closes.
          </div>
        )}
        <main className="page-content">
          <Outlet />
        </main>
        <footer className="workspace-footer">
          <span>
            BMW NEXT <span className="muted">/</span> Product intelligence, with
            perspective.
          </span>
          <span>Synthetic demo · Human approval required</span>
        </footer>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
    </div>
  );
}
