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
import {
  connectModerator,
  useModeratorStore,
} from "../../store/useModeratorStore";
import { moderatorApi } from "../../lib/council/api";
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
  const moderatorId = useModeratorStore((s) => s.id);
  const demoStatus = useAppStore((s) => s.council.status);
  const tickDemo = useAppStore((s) => s.tickCouncil);
  const location = useLocation();
  const liveWorkspace =
    ["/market", "/customer", "/competitor"].includes(location.pathname) ||
    (["/council", "/decisions"].includes(location.pathname) &&
      !new URLSearchParams(location.search).has("demo"));
  const activeIndex = navigation.findIndex(
    (item) => item.to === location.pathname,
  );
  const nextPage = navigation[activeIndex + 1];
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState("");
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    if (demoStatus !== "running") return;
    const timer = setInterval(tickDemo, 4200);
    return () => clearInterval(timer);
  }, [demoStatus, tickDemo]);
  useEffect(() => {
    if (moderatorId) return connectModerator(moderatorId);
  }, [moderatorId]);
  useEffect(() => {
    setOpen(false);
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
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
      const moderator = moderatorId
        ? await moderatorApi.export(moderatorId)
        : undefined;
      await downloadReport({ ...useAppStore.getState(), moderator });
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
          <img src="/images/bmw-logo.svg" className="bmw-roundel" alt="BMW" />
          <span className="brand-divider" />
          <span className="brand-next">
            NEXT<span className="brand-dot">.</span>
          </span>
        </NavLink>
        <div className="workspace-label">YOUR DECISION JOURNEY</div>
        <nav aria-label="Main navigation">
          {navigation.map(({ to, label, icon: Icon }, i) => (
            <NavLink key={to} to={to} aria-label={label}>
              <small className="nav-step">
                {String(i + 1).padStart(2, "0")}
              </small>
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
              <strong>
                {liveWorkspace ? "Local agent workspace" : "Demo environment"}
              </strong>
              <span>
                {liveWorkspace
                  ? "Local Qwen · cited evidence"
                  : "Local session · synthetic data"}
              </span>

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
            <Badge tone="blue">{liveWorkspace ? "AGENTS" : "DEMO"}</Badge>

            <Button
              variant="secondary"
              className="export-button"
              disabled={exporting || (liveWorkspace && !moderatorId)}
              title={
                liveWorkspace && !moderatorId
                  ? "Open a completed council to export its discussion and decision record."
                  : undefined
              }
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
        <div
          className="journey-progress"
          aria-label={`Step ${activeIndex + 1} of 7: ${navigation[activeIndex]?.label}`}
        >
          <span>INTELLIGENCE / {String(activeIndex + 1).padStart(2, "0")}</span>
          <div>
            {navigation.map((item, i) => (
              <NavLink
                key={item.to}
                to={item.to}
                title={item.label}
                aria-label={`Go to step ${i + 1}: ${item.label}`}
                className={i <= activeIndex ? "visited" : ""}
              >
                <span />
              </NavLink>
            ))}
          </div>
          <strong>{navigation[activeIndex]?.label}</strong>
        </div>
        <main className="page-content" key={location.pathname}>
          <Outlet />
          {nextPage && !["/market", "/customer"].includes(location.pathname) && (
            <NavLink className="journey-next" to={nextPage.to}>
              <div>
                <span>
                  CONTINUE YOUR ANALYSIS /{" "}
                  {String(activeIndex + 2).padStart(2, "0")}
                </span>
                <strong>{nextPage.label}</strong>
              </div>
              <ArrowUpRight size={25} />
            </NavLink>
          )}
        </main>
        <footer className="workspace-footer">
          <span>
            BMW NEXT <span className="muted">/</span> Product intelligence, with
            perspective.
          </span>
          <span>
            {liveWorkspace
              ? "Local evidence · Human review required"
              : "Synthetic demo · Human approval required"}
          </span>

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
