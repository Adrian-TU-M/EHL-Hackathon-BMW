import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  Download,
  FileText,
  LockKeyhole,
  Play,
  RefreshCw,
  Sparkles,
  UnlockKeyhole,
} from "lucide-react";
import { Button, Badge, Modal, PageHeader } from "../components/ui/Primitives";
import { BriefEditor } from "../components/presentation/BriefEditor";
import { SlideCanvas } from "../components/presentation/SlideCanvas";
import { StructuredSlideEditor } from "../components/presentation/StructuredSlideEditor";
import { presentationApi } from "../lib/presentation/api";
import {
  audienceLabels,
  departmentOutline,
} from "../lib/presentation/contracts";
import type {
  Audience,
  OutlineItem,
  Presentation,
  PresentationList,
  SlideSpec,
} from "../lib/presentation/contracts";
import { layoutSlide } from "../lib/presentation/layout";
import { useAppStore } from "../store/useAppStore";
import { useShallow } from "zustand/react/shallow";
import "../styles/presentation.css";

const PresentationVoice = lazy(
  () => import("../components/presentation/PresentationVoice"),
);
type Tab = "brief" | "outline" | "slides" | "rehearse" | "sources" | "history";
const tabs: { id: Tab; label: string }[] = [
  { id: "brief", label: "Brief" },
  { id: "outline", label: "Outline" },
  { id: "slides", label: "Slides" },
  { id: "rehearse", label: "Rehearse" },
  { id: "sources", label: "Sources" },
  { id: "history", label: "History" },
];

export default function Presentations() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [listing, setListing] = useState<PresentationList>({
    presentations: [],
    sessions: [],
  });
  const [p, setPresentation] = useState<Presentation | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("brief");
  const [audience, setAudience] = useState<Audience>("executive");
  const [index, setIndex] = useState(0);
  const [runtime, setRuntime] = useState<{
    available: boolean;
    model: string;
  } | null>(null);
  const [presenting, setPresenting] = useState(false);
  const [voice, setVoice] = useState(false);
  const [themePreview, setThemePreview] = useState(false);
  const [ack, setAck] = useState("");
  const activeId = useRef(id);
  activeId.current = id;
  const workspace = useAppStore(
    useShallow((s) => ({
      scope: s.scope,
      requirements: s.requirements,
      evidence: s.evidence,
      findings: s.findings,
      weights: s.weights,
    })),
  );
  const workspaceKey = JSON.stringify(workspace);

  const accept = useCallback((next: Presentation) => {
    if (activeId.current && next.id !== activeId.current) return;
    setPresentation((previous) =>
      previous?.id === next.id &&
      (previous.revision > next.revision ||
        (previous.revision === next.revision &&
          previous.events.length > next.events.length))
        ? previous
        : next,
    );
  }, []);

  useEffect(() => {
    let disposed = false;
    setPresentation(null);
    setError("");
    setTab("brief");
    setIndex(0);
    setVoice(false);
    void presentationApi
      .list()
      .then((data) => {
        if (!disposed) setListing(data);
      })
      .catch((e) => {
        if (!disposed) setError(String(e));
      });
    if (!id)
      return () => {
        disposed = true;
      };
    void presentationApi
      .get(id)
      .then((data) => {
        if (!disposed) {
          accept(data);
          setAudience(data.brief.audience);
          if (Object.values(data.decks).some((d) => d?.complete))
            setTab("slides");
        }
      })
      .catch((e) => {
        if (!disposed) setError(String(e));
      });
    return () => {
      disposed = true;
    };
  }, [id, accept]);

  useEffect(() => {
    if (id) return;
    let disposed = false;
    async function refreshListing() {
      try {
        const [next, health] = await Promise.all([
          presentationApi.list(),
          presentationApi.health(),
        ]);
        if (!disposed) {
          setListing(next);
          setRuntime(health.ollama);
          setError("");
        }
      } catch (e) {
        if (!disposed) setError(e instanceof Error ? e.message : String(e));
      }
    }
    void refreshListing();
    const timer = window.setInterval(() => void refreshListing(), 5000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let disposed = false,
      fetching = false,
      queued = false;
    const stream = new EventSource(`/api/presentations/${id}/events`);
    async function refresh() {
      if (fetching) {
        queued = true;
        return;
      }
      fetching = true;
      do {
        queued = false;
        try {
          const next = await presentationApi.get(id!);
          if (!disposed) accept(next);
        } catch {
          /* A later event or explicit Reload can recover the view. */
        }
      } while (queued && !disposed);
      fetching = false;
    }
    stream.addEventListener("presentation", () => {
      void refresh();
    });
    stream.onerror = () => {
      if (!disposed) void refresh();
    };
    return () => {
      disposed = true;
      stream.close();
    };
  }, [id, accept]);

  useEffect(() => {
    if (!id || !p || p.snapshot.kind !== "dashboard_demo") return;
    let disposed = false;
    const current = p;
    void presentationApi
      .check(current)
      .then((next) => {
        if (!disposed) accept(next);
      })
      .catch(() => {
        /* Explicit Refresh remains available. */
      });
    return () => {
      disposed = true;
    };
    // Only dashboard changes or a new revision need a source comparison.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, workspaceKey, p?.revision, accept]);

  const job = p?.jobs.find(
    (j) => j.status === "running" || j.status === "queued",
  );
  const busy = loading || !!job;
  const deck = p?.decks[audience];
  const selected =
    deck?.slides[Math.min(index, Math.max(0, deck.slides.length - 1))];
  const fitIssues = p
    ? Object.entries(p.decks).flatMap(
        ([a, d]) =>
          d?.slides.flatMap(
            (s, i) => layoutSlide(p, s, i, a as Audience).issues,
          ) || [],
      )
    : [];
  const liveSessions = listing.sessions
    .filter(
      (s) =>
        s.mode !== "deterministic" &&
        (s.proposal_count !== 0 || s.approved_count > 0),
    )
    .sort(
      (a, b) =>
        b.approved_count - a.approved_count ||
        (b.proposal_count || 0) - (a.proposal_count || 0),
    );
  const livePresentations = listing.presentations.filter(
    (item) => !item.synthetic && item.mode === "ollama",
  );
  const samplePresentations = listing.presentations.filter(
    (item) => item.synthetic || item.mode !== "ollama",
  );

  async function run(
    action: () => Promise<Presentation>,
    after?: (next: Presentation) => void,
  ) {
    setLoading(true);
    setError("");
    try {
      const next = await action();
      accept(next);
      after?.(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }
  async function create(
    kind: "isolated_demo" | "dashboard_demo" | "council",
    sessionId?: string,
  ) {
    setLoading(true);
    setError("");
    try {
      const next = await presentationApi.create(kind, "ollama", sessionId);
      navigate(`/presentations/${next.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }
  async function exportDeck(format: "pptx" | "pdf" | "json" | "notes") {
    if (!p) return;
    setLoading(true);
    setError("");
    try {
      const { exportPresentation } = await import("../lib/presentation/export");
      await exportPresentation(p, audience, format);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="presentation-studio">
      <PageHeader
        eyebrow="YOUR DECISIONS / THEIR NEXT CHAPTER"
        title={p ? "Make the case." : "Decisions worth presenting."}
        description="Turn approved decisions into a clear investment case. Shape the story, test the objections, then take it into the room."
        action={
          p ? (
            <Button
              variant="secondary"
              onClick={() => navigate("/presentations")}
            >
              <ArrowLeft size={16} />
              All presentations
            </Button>
          ) : undefined
        }
      />
      {error ? (
        <div className="studio-error" role="alert">
          {error}
          <Button
            variant="ghost"
            onClick={() => {
              if (id) void run(() => presentationApi.get(id));
              else {
                setError("");
                void presentationApi
                  .list()
                  .then(setListing)
                  .catch((e) => setError(String(e)));
              }
            }}
          >
            Reload
          </Button>
        </div>
      ) : null}
      {!id ? (
        <>
          <section className="studio-welcome">
            <div>
              <span className="eyebrow">
                YOUR COUNCIL / YOUR APPROVED REQUIREMENTS
              </span>
              <h2>
                Real decisions.
                <br />
                Ready to present.
              </h2>
              <p>
                Choose a debate below. Local Qwen writes the presentation from
                the exact requirements you accepted, with their evidence and the
                Jury’s reasoning.
              </p>
              <div className="studio-actions">
                <Link
                  className="button primary"
                  to={
                    liveSessions[0]
                      ? `/decisions?session=${liveSessions[0].id}`
                      : "/decisions"
                  }
                >
                  Review Jury requirements <ArrowRight size={17} />
                </Link>
                <Link to="/council">Start a debate</Link>
              </div>
            </div>
            <div className="studio-welcome-aside">
              <span>01 / ACCEPT REQUIREMENTS</span>
              <span>02 / REVIEW THE BRIEF & OUTLINE</span>
              <span>03 / GENERATE WITH QWEN</span>
              <span>04 / REVIEW & EXPORT</span>
              <p role="status">
                {runtime
                  ? runtime.available
                    ? `${runtime.model} · ready on this laptop`
                    : `${runtime.model} is unavailable. Start Ollama before generating.`
                  : "Checking local Qwen…"}
              </p>
            </div>
          </section>
          <section className="studio-card">
            <h2>Choose your council</h2>
            <p>
              Only current, individually accepted requirements enter the deck.
              Pending and rejected requirements stay out. Every accepted
              requirement is covered; ten are welcome, but not required.
            </p>
            {!liveSessions.length && (
              <p>
                No real councils yet. Start a debate, then review its
                requirements.
              </p>
            )}
            {liveSessions.map((s) => (
              <div className="studio-session" key={s.id}>
                <div>
                  <strong>
                    {s.scope
                      ? `BMW ${s.scope.vehicle} · ${s.scope.market}`
                      : "Council"}{" "}
                    · {s.id.slice(-8)}
                  </strong>
                  <p>
                    {s.status.replaceAll("_", " ")} · {s.approved_count}{" "}
                    accepted
                    {typeof s.proposal_count === "number"
                      ? ` / ${s.proposal_count} proposed`
                      : ""}
                  </p>
                </div>
                <div className="studio-actions">
                  <Link to={`/decisions?session=${s.id}`}>
                    Review requirements
                  </Link>
                  <Button
                    disabled={
                      loading || !s.approved_count || !runtime?.available
                    }
                    onClick={() => void create("council", s.id)}
                  >
                    <Sparkles size={16} /> Create presentation
                  </Button>
                </div>
              </div>
            ))}
          </section>
          <section className="studio-library">
            <h2>Your presentations</h2>
            {livePresentations.length ? (
              livePresentations.map((item) => (
                <Link
                  key={item.id}
                  to={`/presentations/${item.id}`}
                  className="studio-library-item"
                >
                  <FileText size={23} />
                  <div>
                    <strong>{item.title}</strong>
                    <p>
                      Revision {item.revision} /{" "}
                      {item.mode === "demo"
                        ? "Synthetic demo writer"
                        : "Local Ollama writer"}{" "}
                      / {item.source_kind.replaceAll("_", " ")}
                    </p>
                  </div>
                  <ArrowRight size={20} />
                </Link>
              ))
            ) : (
              <p className="muted">
                Your presentations will appear here after you create one.
              </p>
            )}
          </section>
          {samplePresentations.length > 0 && (
            <details className="studio-card">
              <summary>
                Previous synthetic samples ({samplePresentations.length})
              </summary>
              <p>
                These are sample decks, separate from your real council
                requirements.
              </p>
              {samplePresentations.map((item) => (
                <p key={item.id}>
                  <Link to={`/presentations/${item.id}`}>
                    {item.title} · synthetic sample
                  </Link>
                </p>
              ))}
            </details>
          )}
        </>
      ) : p ? (
        <>
          <div className="studio-context">
            <div>
              <Badge tone={p.snapshot.synthetic ? "amber" : "blue"}>
                {p.snapshot.synthetic
                  ? "SYNTHETIC DEMO"
                  : "SOURCE-BACKED DECISIONS"}
              </Badge>
              <span>{p.snapshot.decisions.length} approved decisions</span>
              <span>Revision {p.revision}</span>
              <span>
                {p.mode === "demo"
                  ? "Deterministic demo writer"
                  : "Local Ollama / Qwen"}
              </span>
            </div>
            <Badge
              tone={
                p.finalized_revision === p.revision && !p.stale
                  ? "green"
                  : "neutral"
              }
            >
              {p.finalized_revision === p.revision && !p.stale
                ? "PM FINALIZED"
                : "DRAFT"}
            </Badge>
          </div>
          {p.update_available || p.stale ? (
            <div className="studio-notice">
              <strong>
                {p.stale
                  ? "Approved inputs changed. This deck needs review."
                  : "Update available: more recent decision inputs exist."}
              </strong>
              <p>
                Previous decks remain in history. Refreshing creates a new
                snapshot and requires outline approval.
              </p>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(
                    () => presentationApi.refresh(p),
                    () => setTab("outline"),
                  )
                }
              >
                <RefreshCw size={16} />
                Refresh from decisions
              </Button>
            </div>
          ) : null}
          {job ? (
            <div className="generation-progress" role="status">
              <div>
                <strong>{job.message}</strong>
                <span>{job.progress}%</span>
              </div>
              <progress max={100} value={job.progress} />
              <Button
                variant="ghost"
                disabled={loading}
                onClick={() =>
                  void run(() => presentationApi.cancel(p, job.id))
                }
              >
                Cancel generation
              </Button>
            </div>
          ) : null}
          {!job && p.jobs.at(-1)?.error ? (
            <div className="studio-error" role="alert">
              <strong>Generation stopped. Your checkpoints are saved.</strong>
              <p>{p.jobs.at(-1)?.error}</p>
              <Button
                disabled={busy}
                variant="secondary"
                onClick={() => {
                  const last = p.jobs.at(-1)!;
                  const operation = last.operation;
                  if (operation === "revision")
                    setError(
                      "Select the slide and request the revision again.",
                    );
                  else
                    void run(() =>
                      presentationApi.generate(p, operation, last.audience),
                    );
                }}
              >
                Retry generation
              </Button>
            </div>
          ) : null}
          <nav className="studio-tabs" aria-label="Presentation workflow">
            {tabs.map((t) => (
              <button
                key={t.id}
                className={tab === t.id ? "active" : ""}
                aria-current={tab === t.id ? "step" : undefined}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>

          {tab === "brief" ? (
            <BriefEditor
              key={`${p.id}-${p.revision}`}
              initial={p.brief}
              disabled={busy}
              demo={p.mode === "demo"}
              onSave={(brief) =>
                void run(
                  () => presentationApi.brief(p, brief),
                  (next) => {
                    setAudience(next.brief.audience);
                    setTab("outline");
                  },
                )
              }
            />
          ) : null}

          {tab === "outline" ? (
            <OutlineEditor
              key={`${p.id}-${p.revision}-${audience}`}
              p={p}
              audience={audience}
              onAudience={setAudience}
              busy={busy}
              onApprove={(items) =>
                void run(
                  () => presentationApi.outline(p, items, audience),
                  () => setTab("slides"),
                )
              }
              onRefine={() =>
                void run(() => presentationApi.generate(p, "outline", audience))
              }
            />
          ) : null}

          {tab === "slides" ? (
            <>
              <div className="studio-section-intro">
                <span className="eyebrow">03 / REFINE THE PRESENTATION</span>
                <h2>One business case. The right emphasis.</h2>
              </div>
              <div className="studio-toolbar">
                <label>
                  Audience version
                  <select
                    aria-label="Audience version"
                    value={audience}
                    onChange={(e) => {
                      setAudience(e.target.value as Audience);
                      setIndex(0);
                    }}
                  >
                    {Object.entries(audienceLabels).map(([a, label]) => (
                      <option key={a} value={a}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="studio-actions">
                  {!deck?.complete ? (
                    <Button
                      disabled={
                        busy ||
                        !departmentOutline(p, audience).approved ||
                        p.stale
                      }
                      onClick={() =>
                        void run(() =>
                          presentationApi.generate(
                            p,
                            Object.keys(p.decks).length ? "variant" : "slides",
                            audience,
                          ),
                        )
                      }
                    >
                      <Sparkles size={16} />
                      {deck?.slides.length
                        ? "Resume slide generation"
                        : "Generate audience deck"}
                    </Button>
                  ) : (
                    <>
                      <Button
                        variant="secondary"
                        onClick={() => setPresenting(true)}
                      >
                        <Play size={16} />
                        Present
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void exportDeck("pptx")}
                      >
                        <Download size={16} />
                        PowerPoint
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void exportDeck("pdf")}
                      >
                        PDF
                      </Button>
                    </>
                  )}
                </div>
              </div>
              {deck ? (
                <div className="studio-theme-status">
                  <span>
                    Theme:{" "}
                    {deck.theme_id === "bmw-cinematic-v1"
                      ? "BMW · Cinematic Automotive"
                      : deck.theme_id === "bmw-executive-v2"
                        ? "BMW · Executive Automotive 02"
                        : deck.theme_id === "bmw-executive-v1"
                          ? "BMW · Executive Automotive 01"
                          : deck.theme_id === "premium-v1"
                            ? "BMW NEXT · Premium 01"
                            : "Original"}
                  </span>
                  {deck.theme_id !== "bmw-cinematic-v1" ? (
                    <>
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => setThemePreview(true)}
                      >
                        Preview BMW theme
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            presentationApi.applyTheme(p, audience),
                          )
                        }
                      >
                        Apply BMW theme
                      </Button>
                    </>
                  ) : null}
                  <small>
                    Theme changes preserve slide text, order and locks.
                  </small>
                </div>
              ) : null}
              {themePreview && selected && deck ? (
                <Modal
                  title="Preview BMW Cinematic Automotive theme"
                  wide
                  onClose={() => setThemePreview(false)}
                >
                  <p>
                    Preview only. Your slide text, order and locks are retained.
                    Applying creates a new revision for review.
                  </p>
                  <SlideCanvas
                    presentation={{
                      ...p,
                      decks: {
                        ...p.decks,
                        [audience]: { ...deck, theme_id: "bmw-cinematic-v1" },
                      },
                    }}
                    slide={selected}
                    index={index}
                    audience={audience}
                  />
                  <div className="studio-actions">
                    <Button
                      variant="secondary"
                      disabled={index === 0}
                      onClick={() => setIndex(index - 1)}
                    >
                      Previous slide
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={index >= deck.slides.length - 1}
                      onClick={() => setIndex(index + 1)}
                    >
                      Next slide
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () => presentationApi.applyTheme(p, audience),
                          () => setThemePreview(false),
                        )
                      }
                    >
                      Apply BMW theme
                    </Button>
                  </div>
                  {layoutSlide(
                    {
                      ...p,
                      decks: {
                        ...p.decks,
                        [audience]: { ...deck, theme_id: "bmw-cinematic-v1" },
                      },
                    },
                    selected,
                    index,
                    audience,
                  ).issues.map((issue) => (
                    <p className="studio-notice" key={issue}>
                      {issue}
                    </p>
                  ))}
                </Modal>
              ) : null}
              {!departmentOutline(p, audience).approved ? (
                <div className="studio-notice">
                  Review and approve the outline before generating slides.{" "}
                  <Button variant="ghost" onClick={() => setTab("outline")}>
                    Open outline
                  </Button>
                </div>
              ) : null}
              {selected && deck ? (
                <>
                  <div className="slide-workspace">
                    <aside
                      className="slide-thumbnails"
                      aria-label="Slide thumbnails"
                    >
                      {deck.slides.map((s, i) => (
                        <button
                          key={s.id}
                          aria-label={`Open slide ${i + 1}: ${s.title}`}
                          aria-pressed={selected.id === s.id}
                          onClick={() => setIndex(i)}
                        >
                          {s.section &&
                          (i === 0 ||
                            s.section !== deck.slides[i - 1].section) ? (
                            <span className="thumbnail-section">
                              {s.section}
                            </span>
                          ) : null}
                          <SlideCanvas
                            presentation={p}
                            slide={s}
                            index={i}
                            audience={audience}
                          />
                          <span>
                            {String(i + 1).padStart(2, "0")} {s.title}
                            {s.locked ? " / locked" : ""}
                          </span>
                        </button>
                      ))}
                    </aside>
                    <div className="slide-main">
                      <SlideCanvas
                        presentation={p}
                        slide={selected}
                        index={Math.min(index, deck.slides.length - 1)}
                        audience={audience}
                      />
                      <div className="slide-position">
                        <span>
                          {index + 1} / {deck.slides.length}
                        </span>
                        <div className="studio-actions">
                          <Button
                            variant="ghost"
                            disabled={busy || index === 0}
                            aria-label="Move slide earlier"
                            onClick={() => {
                              const slides = [...deck.slides];
                              [slides[index - 1], slides[index]] = [
                                slides[index],
                                slides[index - 1],
                              ];
                              void run(
                                () => presentationApi.edit(p, audience, slides),
                                () => setIndex(index - 1),
                              );
                            }}
                          >
                            <ArrowUp size={16} />
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={busy || index >= deck.slides.length - 1}
                            aria-label="Move slide later"
                            onClick={() => {
                              const slides = [...deck.slides];
                              [slides[index + 1], slides[index]] = [
                                slides[index],
                                slides[index + 1],
                              ];
                              void run(
                                () => presentationApi.edit(p, audience, slides),
                                () => setIndex(index + 1),
                              );
                            }}
                          >
                            <ArrowDown size={16} />
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={busy}
                            onClick={() =>
                              void run(() =>
                                presentationApi.edit(
                                  p,
                                  audience,
                                  deck.slides.map((s) =>
                                    s.id === selected.id
                                      ? { ...s, locked: !s.locked }
                                      : s,
                                  ),
                                ),
                              )
                            }
                          >
                            {selected.locked ? (
                              <UnlockKeyhole size={16} />
                            ) : (
                              <LockKeyhole size={16} />
                            )}
                            {selected.locked ? "Unlock slide" : "Lock slide"}
                          </Button>
                        </div>
                      </div>
                      <SlideEditor
                        key={`${p.revision}-${selected.id}-${audience}`}
                        slide={selected}
                        disabled={busy}
                        onSave={(s) =>
                          void run(() =>
                            presentationApi.edit(
                              p,
                              audience,
                              deck.slides.map((old) =>
                                old.id === s.id ? s : old,
                              ),
                            ),
                          )
                        }
                        onRevise={(instruction) =>
                          void run(() =>
                            presentationApi.revise(
                              p,
                              audience,
                              selected.id,
                              instruction,
                            ),
                          )
                        }
                      />
                    </div>
                  </div>
                  <div className="studio-actions">
                    <Button
                      variant="secondary"
                      onClick={() => setVoice(!voice)}
                    >
                      {voice ? "Close voice assistant" : "Open voice assistant"}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void exportDeck("notes")}
                    >
                      Download speaker notes
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void exportDeck("json")}
                    >
                      Snapshot JSON
                    </Button>
                  </div>
                  {voice ? (
                    <Suspense fallback={<p>Loading voice assistant…</p>}>
                      <PresentationVoice
                        presentation={p}
                        audience={audience}
                        slide={selected}
                        onAccept={accept}
                        onNavigate={setIndex}
                      />
                    </Suspense>
                  ) : null}
                  {p.proposals
                    .filter((c) => c.status === "pending")
                    .map((c) => (
                      <section
                        className="studio-card revision-comparison"
                        key={c.id}
                      >
                        <span className="eyebrow">
                          PROPOSED CHANGE / {audienceLabels[c.audience]}
                        </span>
                        <h3>{c.instruction}</h3>
                        <div className="revision-diff">
                          <div>
                            <strong>Current</strong>
                            <p>{c.before.takeaway}</p>
                            <pre>
                              {c.before.content
                                ? c.before.content.items
                                    .map((row) =>
                                      [
                                        row.label,
                                        row.detail,
                                        row.owner,
                                        row.timing,
                                        row.dependency,
                                        row.condition,
                                      ]
                                        .filter(Boolean)
                                        .join(" · "),
                                    )
                                    .join("\n\n")
                                : c.before.points.join("\n")}
                            </pre>
                            <pre>{c.before.notes}</pre>
                          </div>
                          <div>
                            <strong>Proposed</strong>
                            <p>{c.after.takeaway}</p>
                            <pre>
                              {c.after.content
                                ? c.after.content.items
                                    .map((row) =>
                                      [
                                        row.label,
                                        row.detail,
                                        row.owner,
                                        row.timing,
                                        row.dependency,
                                        row.condition,
                                      ]
                                        .filter(Boolean)
                                        .join(" · "),
                                    )
                                    .join("\n\n")
                                : c.after.points.join("\n")}
                            </pre>
                            <pre>{c.after.notes}</pre>
                          </div>
                        </div>
                        <div className="studio-actions">
                          <Button
                            disabled={
                              busy || c.expected_revision !== p.revision
                            }
                            onClick={() =>
                              void run(() =>
                                presentationApi.apply(p, c.id, "apply"),
                              )
                            }
                          >
                            <Check size={16} />
                            Apply proposed revision
                          </Button>
                          <Button
                            disabled={busy}
                            variant="secondary"
                            onClick={() =>
                              void run(() =>
                                presentationApi.apply(p, c.id, "discard"),
                              )
                            }
                          >
                            Discard
                          </Button>
                          {c.expected_revision !== p.revision ? (
                            <span className="small">
                              Deck changed. Request a fresh proposal.
                            </span>
                          ) : null}
                        </div>
                      </section>
                    ))}
                  {fitIssues.length ? (
                    <div className="studio-error" role="alert">
                      {fitIssues.map((issue) => (
                        <p key={issue}>{issue}</p>
                      ))}
                    </div>
                  ) : null}
                  {deck.complete ? (
                    <section className="studio-card">
                      <h3>PM review and finalization</h3>
                      {p.review_findings.map((f, i) => (
                        <p key={i}>{f}</p>
                      ))}
                      <label>
                        Review acknowledgment
                        <textarea
                          aria-label="Review acknowledgment"
                          rows={2}
                          value={ack}
                          onChange={(e) => setAck(e.target.value)}
                          placeholder="Record how you reviewed the remaining findings and assumptions."
                          maxLength={4000}
                        />
                      </label>
                      <div className="studio-actions">
                        <Button
                          disabled={
                            busy ||
                            p.stale ||
                            !!fitIssues.length ||
                            (!!p.review_findings.length && !ack.trim())
                          }
                          onClick={() =>
                            void run(() => presentationApi.finalize(p, ack))
                          }
                        >
                          <Check size={16} />
                          Finalize presentation revision
                        </Button>
                        <p className="small muted">
                          PM finalization confirms this presentation revision.
                          It does not approve the investment budget.
                        </p>
                      </div>
                    </section>
                  ) : null}
                </>
              ) : departmentOutline(p, audience).approved ? (
                <div className="studio-empty">
                  <Sparkles size={32} />
                  <h3>Your argument is ready for slides.</h3>
                  <p>
                    Generate this audience version from the approved outline.
                  </p>
                </div>
              ) : null}
            </>
          ) : null}

          {tab === "rehearse" ? (
            <RehearsalPanel
              p={p}
              audience={audience}
              onAudience={setAudience}
              busy={busy}
              onRun={run}
              onAccept={accept}
              slide={selected}
              onNavigate={setIndex}
            />
          ) : null}
          {tab === "sources" ? (
            <section className="studio-sources">
              <div className="studio-section-intro">
                <span className="eyebrow">
                  FROZEN INPUTS / EXACT REFERENCES
                </span>
                <h2>The reasoning behind the recommendation.</h2>
                <p>
                  Snapshot {p.snapshot.source_hash.slice(0, 16)} /{" "}
                  {p.snapshot.kind.replaceAll("_", " ")}
                </p>
              </div>
              {p.snapshot.limitations.map((s, i) => (
                <p className="studio-notice" key={i}>
                  {s}
                </p>
              ))}
              <h3>Approved decision portfolio</h3>
              {p.snapshot.decisions.map((d) => (
                <article className="studio-card" key={d.id}>
                  <Badge>
                    {d.id} / v{d.version}
                  </Badge>
                  <h3>{d.title}</h3>
                  <p>{d.description}</p>
                  <p>
                    <strong>PM rationale:</strong> {d.pm_rationale}
                  </p>
                  <p>
                    <strong>Assessment:</strong> {d.rationale}
                  </p>
                  <p>
                    <strong>Uncertainty:</strong> {d.uncertainties.join(" ")}
                  </p>
                  <p>
                    <strong>Assumptions:</strong> {d.assumptions.join(" ")}
                  </p>
                  <details>
                    <summary>Debate, alternatives and approval history</summary>
                    <pre>
                      {JSON.stringify(
                        {
                          debate: d.debate,
                          alternatives: d.alternatives,
                          history: d.history,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </article>
              ))}
              <h3>Active source passages</h3>
              {p.snapshot.evidence.map((e) => (
                <article className="studio-card" key={e.id}>
                  <strong>
                    {e.id} / {e.source}
                  </strong>
                  <p className="small muted">
                    {e.location} / {e.provenance}
                  </p>
                  <blockquote>{e.passage}</blockquote>
                  {e.limitations.map((l, i) => (
                    <p key={i}>{l}</p>
                  ))}
                </article>
              ))}
              <details>
                <summary>Scenario weights and financial calculations</summary>
                <pre>
                  {JSON.stringify(
                    {
                      weights: p.snapshot.weights,
                      business_case: p.business_case,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </section>
          ) : null}
          {tab === "history" ? (
            <section className="studio-history">
              <div className="studio-section-intro">
                <span className="eyebrow">PM CONTROL / VERSION HISTORY</span>
                <h2>Every revision has a reason.</h2>
              </div>
              {[...p.history].reverse().map((r, i) => (
                <details className="studio-card" key={`${r.revision}-${i}`}>
                  <summary>
                    Revision {r.revision} / {r.reason}
                  </summary>
                  <p>
                    {new Date(r.at).toLocaleString("en-GB", {
                      timeZone: "Europe/Berlin",
                    })}
                  </p>
                  <p>
                    {r.snapshot.decisions.length} approved requirements /{" "}
                    {r.snapshot.source_hash.slice(0, 16)}
                  </p>
                  <div className="history-decks">
                    {Object.entries(r.decks).map(([a, d]) => (
                      <div key={a}>
                        <strong>{audienceLabels[a as Audience]}</strong>
                        <ol>
                          {d.slides.map((s) => (
                            <li key={s.id}>
                              {s.title}
                              <details>
                                <summary>Saved slide content</summary>
                                <p>{s.takeaway}</p>
                                {s.points.map((t, n) => (
                                  <p key={n}>{t}</p>
                                ))}
                                <pre>{s.notes}</pre>
                              </details>
                            </li>
                          ))}
                        </ol>
                      </div>
                    ))}
                  </div>
                </details>
              ))}
              <details className="studio-card">
                <summary>Ordered presentation events</summary>
                {p.events.map((e) => (
                  <p key={e.sequence}>
                    <strong>
                      {e.sequence} / {e.stage}
                    </strong>{" "}
                    {e.message}
                    {e.rationale ? ` / ${e.rationale}` : ""}
                  </p>
                ))}
              </details>
              {p.voice_messages.length ? (
                <details className="studio-card">
                  <summary>Saved voice/text conversations</summary>
                  {p.voice_messages.map((m) => (
                    <p key={m.id}>
                      <strong>{m.role}:</strong> {m.text}
                    </p>
                  ))}
                </details>
              ) : null}
            </section>
          ) : null}
          {presenting && deck?.complete ? (
            <Presenter
              p={p}
              audience={audience}
              start={index}
              onClose={() => setPresenting(false)}
            />
          ) : null}
        </>
      ) : (
        <div className="studio-empty">
          {error
            ? "Use Reload to reconnect to the presentation service."
            : "Loading presentation…"}
        </div>
      )}
    </div>
  );
}

function OutlineEditor({
  audience,
  onAudience,
  p,
  busy,
  onApprove,
  onRefine,
}: {
  p: Presentation;
  busy: boolean;
  audience: Audience;
  onAudience: (audience: Audience) => void;
  onApprove: (items: OutlineItem[]) => void;
  onRefine: () => void;
}) {
  const [items, setItems] = useState(() =>
    structuredClone(departmentOutline(p, audience).items),
  );
  return (
    <section>
      <div className="studio-section-intro">
        <span className="eyebrow">02 / APPROVE THE ARGUMENT</span>
        <h2>The story before the styling.</h2>
        <p>
          Review the sequence and the purpose of each slide. Supporting sources
          and detailed decision rationale will stay in the appendix and speaker
          notes.
        </p>
      </div>
      <label className="department-selector">
        Department outline
        <select
          aria-label="Department outline"
          value={audience}
          onChange={(e) => onAudience(e.target.value as Audience)}
        >
          {Object.entries(audienceLabels).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <p className="small muted">
        Each department has its own story and review. All versions share the
        same investment assumptions.
      </p>
      <ol className="outline-list">
        {items.map((item, i) => (
          <li key={item.id}>
            <span>{String(i + 1).padStart(2, "0")}</span>
            <div>
              <input
                aria-label={`Slide ${i + 1} outline title`}
                value={item.title}
                maxLength={100}
                onChange={(e) =>
                  setItems(
                    items.map((t, n) =>
                      n === i ? { ...t, title: e.target.value } : t,
                    ),
                  )
                }
              />
              <textarea
                aria-label={`Slide ${i + 1} purpose`}
                value={item.purpose}
                maxLength={220}
                rows={2}
                onChange={(e) =>
                  setItems(
                    items.map((t, n) =>
                      n === i ? { ...t, purpose: e.target.value } : t,
                    ),
                  )
                }
              />
              <label className="outline-section-label">
                Section
                <input
                  aria-label={`Slide ${i + 1} section`}
                  value={item.section || ""}
                  maxLength={80}
                  onChange={(e) =>
                    setItems(
                      items.map((t, n) =>
                        n === i ? { ...t, section: e.target.value } : t,
                      ),
                    )
                  }
                />
              </label>
              <small>{item.decision_ids.join(", ")}</small>
            </div>
          </li>
        ))}
      </ol>
      <div className="studio-actions">
        <Button
          disabled={
            busy ||
            p.stale ||
            items.some((i) => !i.title.trim() || !i.purpose.trim())
          }
          onClick={() => onApprove(items)}
        >
          <Check size={16} />
          Approve outline
        </Button>
        <Button
          variant="secondary"
          disabled={busy || p.stale || departmentOutline(p, audience).approved}
          onClick={onRefine}
        >
          <Sparkles size={16} />
          Refine outline with {p.mode === "demo" ? "demo writer" : "Qwen"}
        </Button>
      </div>
    </section>
  );
}

function SlideEditor({
  slide,
  disabled,
  onSave,
  onRevise,
}: {
  slide: SlideSpec;
  disabled: boolean;
  onSave: (s: SlideSpec) => void;
  onRevise: (instruction: string) => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(slide));
  const [instruction, setInstruction] = useState("");
  const protectedPoints = ["financial", "closing", "cover"].includes(
    slide.layout,
  );
  return (
    <section className="slide-editor">
      <div className="studio-section-intro">
        <span className="eyebrow">
          SLIDE EDITOR / {slide.locked ? "LOCKED" : "YOUR WORDS"}
        </span>
      </div>
      <fieldset disabled={disabled || slide.locked}>
        <label>
          Slide title
          <input
            aria-label="Slide title"
            value={draft.title}
            maxLength={100}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </label>
        <label>
          Main takeaway
          <textarea
            aria-label="Slide takeaway"
            value={draft.takeaway}
            rows={2}
            maxLength={220}
            onChange={(e) => setDraft({ ...draft, takeaway: e.target.value })}
          />
        </label>
        {draft.content ? (
          <StructuredSlideEditor
            content={draft.content}
            onChange={(content) =>
              setDraft({
                ...draft,
                content,
                points: content.items.map((item) => item.detail),
              })
            }
          />
        ) : (
          <label>
            Slide points, one per line
            <textarea
              aria-label="Slide points"
              rows={5}
              value={draft.points.join("\n")}
              readOnly={protectedPoints}
              onChange={(e) =>
                setDraft({ ...draft, points: e.target.value.split("\n") })
              }
            />
          </label>
        )}
        {protectedPoints ? (
          <p className="small muted">
            Financial point text comes from the brief and calculations. Update
            the assumptions in Brief to change it.
          </p>
        ) : null}
        <label>
          Speaker notes
          <textarea
            aria-label="Speaker notes"
            rows={5}
            maxLength={10000}
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          />
        </label>
        <Button
          disabled={
            !draft.title.trim() ||
            draft.points.length > 4 ||
            draft.points.some((t) => t.length > 180)
          }
          onClick={() => onSave(draft)}
        >
          Save slide changes
        </Button>
        <div className="revision-request">
          <label>
            Ask for a targeted revision
            <textarea
              aria-label="Revision request"
              rows={2}
              maxLength={2000}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="Make this clearer for Finance and preserve the uncertainty."
            />
          </label>
          <Button
            variant="secondary"
            disabled={!instruction.trim()}
            onClick={() => onRevise(instruction)}
          >
            <Sparkles size={16} />
            Propose revision
          </Button>
        </div>
      </fieldset>
    </section>
  );
}

function RehearsalPanel({
  p,
  audience,
  onAudience,
  busy,
  onRun,
  onAccept,
  slide,
  onNavigate,
}: {
  p: Presentation;
  audience: Audience;
  onAudience: (a: Audience) => void;
  busy: boolean;
  onRun: (
    action: () => Promise<Presentation>,
    after?: (next: Presentation) => void,
  ) => Promise<void>;
  onAccept: (next: Presentation) => void;
  slide?: SlideSpec;
  onNavigate: (index: number) => void;
}) {
  const [persona, setPersona] = useState("cfo");
  const [answer, setAnswer] = useState("");
  const [voice, setVoice] = useState(false);
  const rehearsal = p.rehearsals.at(-1);
  return (
    <section className="rehearsal-panel">
      <div className="studio-section-intro">
        <span className="eyebrow">04 / BEFORE YOU ENTER THE ROOM</span>
        <h2>Practice the questions that matter.</h2>
        <p>
          Defend the assumptions and the funding gates. The coach reviews your
          answers without changing the presentation.
        </p>
      </div>
      <div className="studio-actions">
        <label>
          Rehearsal audience
          <select
            value={audience}
            onChange={(e) => onAudience(e.target.value as Audience)}
          >
            {Object.entries(audienceLabels).map(([a, label]) => (
              <option key={a} value={a}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Challenger
          <select
            aria-label="Rehearsal persona"
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
          >
            <option value="cfo">CFO</option>
            <option value="engineering">Engineering leader</option>
            <option value="executive">Executive sponsor</option>
            <option value="sales">Sales & marketing leader</option>
          </select>
        </label>
        <Button
          disabled={busy || !p.decks[audience]?.complete}
          onClick={() =>
            void onRun(() => presentationApi.rehearsal(p, persona, audience))
          }
        >
          Start rehearsal
        </Button>
      </div>
      {!p.decks[audience]?.complete ? (
        <p className="studio-notice">
          Generate this audience deck before starting a rehearsal.
        </p>
      ) : null}
      {rehearsal ? (
        <>
          <div className="rehearsal-transcript">
            {rehearsal.messages.map((m, i) => (
              <article key={i} className={m.role === "user" ? "from-pm" : ""}>
                <strong>
                  {m.role === "user"
                    ? "Your answer"
                    : "Coach / " + rehearsal.persona}
                </strong>
                <p>{m.text}</p>
              </article>
            ))}
          </div>
          {!rehearsal.complete ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void onRun(
                  () => presentationApi.answer(p, rehearsal.id, answer),
                  () => setAnswer(""),
                );
              }}
            >
              <label>
                Your response
                <textarea
                  aria-label="Rehearsal answer"
                  rows={4}
                  value={answer}
                  maxLength={5000}
                  onChange={(e) => setAnswer(e.target.value)}
                />
              </label>
              <Button
                disabled={
                  busy ||
                  !answer.trim() ||
                  rehearsal.deck_revision !== p.revision
                }
                type="submit"
              >
                Review answer & next objection
              </Button>
            </form>
          ) : (
            <div className="studio-notice">
              <strong>Rehearsal complete</strong>
              <p>{rehearsal.feedback.join(" ")}</p>
              <p>
                Use these findings to refine your argument before the meeting.
              </p>
            </div>
          )}
          <Button variant="secondary" onClick={() => setVoice(!voice)}>
            {voice ? "Close voice rehearsal" : "Open voice rehearsal"}
          </Button>
          {voice ? (
            <Suspense fallback={<p>Loading voice rehearsal…</p>}>
              <PresentationVoice
                presentation={p}
                audience={rehearsal.audience}
                slide={slide}
                persona={rehearsal.persona}
                onAccept={onAccept}
                onNavigate={onNavigate}
              />
            </Suspense>
          ) : null}
        </>
      ) : (
        <div className="studio-empty">
          Choose a challenger to begin a three-question rehearsal.
        </div>
      )}
    </section>
  );
}

function Presenter({
  p,
  audience,
  start,
  onClose,
}: {
  p: Presentation;
  audience: Audience;
  start: number;
  onClose: () => void;
}) {
  const slides = p.decks[audience]!.slides;
  const [index, setIndex] = useState(start);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const began = Date.now();
    const timer = window.setInterval(
      () => setSeconds(Math.floor((Date.now() - began) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, []);
  const sourceIds = slides[index].evidence_ids;
  return (
    <Modal title="Presenter view" wide onClose={onClose}>
      <div
        className="presenter-view"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight")
            setIndex((i) => Math.min(slides.length - 1, i + 1));
          if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
        }}
      >
        <SlideCanvas
          presentation={p}
          slide={slides[index]}
          index={index}
          audience={audience}
        />
        <div className="presenter-controls">
          <Button
            variant="secondary"
            disabled={index === 0}
            onClick={() => setIndex((i) => i - 1)}
          >
            <ArrowLeft size={16} />
            Previous
          </Button>
          <span>
            {index + 1} / {slides.length} / {Math.floor(seconds / 60)}:
            {String(seconds % 60).padStart(2, "0")} elapsed / {p.brief.minutes}{" "}
            min planned
          </span>
          <Button
            variant="secondary"
            disabled={index === slides.length - 1}
            onClick={() => setIndex((i) => i + 1)}
          >
            Next
            <ArrowRight size={16} />
          </Button>
        </div>
        <details open>
          <summary>Speaker notes</summary>
          <p className="presenter-notes">{slides[index].notes}</p>
          <p className="small muted">
            {p.snapshot.evidence
              .filter((e) => sourceIds.includes(e.id))
              .map((e) => `${e.id}: ${e.source} / ${e.location}`)
              .join("\n")}
          </p>
        </details>
      </div>
    </Modal>
  );
}
