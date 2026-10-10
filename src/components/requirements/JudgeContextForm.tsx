import { useState } from "react";
import { useAppStore } from "../../store/useAppStore";
import { Button } from "../ui/Primitives";
import type { Domain } from "../../lib/types";

export function JudgeContextForm({ disabled }: { disabled: boolean }) {
  const state = useAppStore();
  const [background, setBackground] = useState(state.judgeBackground ?? "");
  const [featureId, setFeatureId] = useState("");
  const [domain, setDomain] = useState<Domain>("customer");
  const [source, setSource] = useState("");
  const [location, setLocation] = useState("");
  const [date, setDate] = useState("");
  const [passage, setPassage] = useState("");
  const [url, setUrl] = useState("");
  const [notice, setNotice] = useState("");
  return <details className="details-panel">
    <summary>Project background and real source data</summary>
    <p>The Judge reads the current features, linked evidence, exclusions and priorities. Add your project context or an original source passage here. Saving changes requires a fresh evaluation.</p>
    <label className="field-label" htmlFor="judge-background">Project background</label>
    <textarea id="judge-background" value={background} maxLength={20000} disabled={disabled} onChange={e => setBackground(e.target.value)} placeholder="Describe the product, users, constraints and decisions the Judge should consider." />
    <Button disabled={disabled || background === (state.judgeBackground ?? "")} onClick={() => { state.setJudgeBackground(background); setNotice("Background saved. Start a fresh Judge council."); }}>Save background</Button>
    <p>Provided passages retain their source labels. They are not automatically authenticated, and synthetic sample records remain labelled.</p>
    <label className="field-label" htmlFor="judge-source-feature">Feature supported by this source</label>
    <select id="judge-source-feature" disabled={disabled} value={featureId} onChange={e => setFeatureId(e.target.value)}><option value="">Choose a feature</option>{state.requirements.map(r => <option value={r.id} key={r.id}>{r.title}</option>)}</select>
    <label className="field-label" htmlFor="judge-source-domain">Perspective</label>
    <select id="judge-source-domain" disabled={disabled} value={domain} onChange={e => setDomain(e.target.value as Domain)}><option value="customer">Customer</option><option value="market">Market trends</option><option value="competitor">Competitor</option></select>
    <label className="field-label" htmlFor="judge-source-name">Source name</label><input id="judge-source-name" value={source} disabled={disabled} onChange={e => setSource(e.target.value)} />
    <label className="field-label" htmlFor="judge-source-location">Page, row or section</label><input id="judge-source-location" value={location} disabled={disabled} onChange={e => setLocation(e.target.value)} />
    <label className="field-label" htmlFor="judge-source-date">Source date</label><input id="judge-source-date" type="date" value={date} disabled={disabled} onChange={e => setDate(e.target.value)} />
    <label className="field-label" htmlFor="judge-source-url">Original URL (optional)</label><input id="judge-source-url" type="url" value={url} disabled={disabled} onChange={e => setUrl(e.target.value)} />
    <label className="field-label" htmlFor="judge-source-passage">Original evidence passage</label><textarea id="judge-source-passage" value={passage} maxLength={20000} disabled={disabled} onChange={e => setPassage(e.target.value)} />
    <Button disabled={disabled || !featureId || !source.trim() || !location.trim() || !date || !passage.trim()} onClick={() => {
      try { state.attachProvidedEvidence(featureId, { domain, source, location, publishedAt: date, passage, sourceUrl: url || undefined }); setPassage(""); setNotice("Source attached to the current feature. Start a fresh Judge council to evaluate it."); }
      catch (e) { setNotice(e instanceof Error ? e.message : "Unable to attach source."); }
    }}>Attach source passage</Button>
    {notice && <p role="status">{notice}</p>}
  </details>;
}
