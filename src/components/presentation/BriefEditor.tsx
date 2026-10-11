import { useState } from "react";
import { Button } from "../ui/Primitives";
import { audienceLabels } from "../../lib/presentation/contracts";
import type {
  Audience,
  FinancialInput,
  FinancialPlan,
  PresentationBrief,
} from "../../lib/presentation/contracts";

const fields: {
  key: keyof FinancialPlan;
  label: string;
  rate?: boolean;
  index?: number;
}[] = [
  { key: "pilot", label: "Pilot investment" },
  { key: "development", label: "Development investment" },
  { key: "rollout", label: "Rollout investment" },
  { key: "annual_opex", label: "Annual operating cost" },
  { key: "eligible_volume", label: "Eligible vehicles per year" },
  {
    key: "contribution",
    label: "Incremental contribution per adopted vehicle",
  },
  { key: "adoption", index: 0, label: "Year 1 adoption (%)", rate: true },
  { key: "adoption", index: 1, label: "Year 2 adoption (%)", rate: true },
  { key: "adoption", index: 2, label: "Year 3 adoption (%)", rate: true },
  { key: "discount_rate", label: "Discount rate (%)", rate: true },
];

export function BriefEditor({
  initial,
  disabled,
  demo,
  onSave,
}: {
  initial: PresentationBrief;
  disabled: boolean;
  demo: boolean;
  onSave: (brief: PresentationBrief) => void;
}) {
  const [brief, setBrief] = useState(() => structuredClone(initial));
  function financial(
    key: keyof FinancialPlan,
    index: number | undefined,
    item: FinancialInput,
  ) {
    setBrief((b) => ({
      ...b,
      financials: {
        ...b.financials,
        [key]:
          index === undefined
            ? item
            : b.financials.adoption.map((a, i) => (i === index ? item : a)),
      },
    }));
  }
  return (
    <form
      className="presentation-brief"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(brief);
      }}
    >
      <div className="studio-section-intro">
        <span className="eyebrow">01 / YOUR BRIEF</span>
        <h2>Shape the argument before the slides.</h2>
        <p>
          Set the decision you need, who needs to hear it, and the assumptions
          they should challenge.
        </p>
      </div>
      <div className="brief-grid">
        <label className="full">
          Presentation title
          <input
            required
            maxLength={100}
            value={brief.title}
            onChange={(e) => setBrief({ ...brief, title: e.target.value })}
          />
        </label>
        <label>
          Presenter name (optional)
          <input
            maxLength={80}
            value={brief.presenter_name || ""}
            onChange={(e) =>
              setBrief({ ...brief, presenter_name: e.target.value })
            }
          />
        </label>
        <label>
          Presenter role (optional)
          <input
            maxLength={100}
            value={brief.presenter_role || ""}
            onChange={(e) =>
              setBrief({ ...brief, presenter_role: e.target.value })
            }
          />
        </label>
        <label>
          Meeting date (optional)
          <input
            type="date"
            value={brief.meeting_date || ""}
            onChange={(e) =>
              setBrief({ ...brief, meeting_date: e.target.value })
            }
          />
        </label>
        <label>
          Primary audience
          <select
            value={brief.audience}
            onChange={(e) =>
              setBrief({ ...brief, audience: e.target.value as Audience })
            }
          >
            {Object.entries(audienceLabels).map(([id, label]) => (
              <option value={id} key={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Meeting duration (minutes)
          <input
            type="number"
            min={5}
            max={60}
            required
            value={brief.minutes}
            onChange={(e) =>
              setBrief({ ...brief, minutes: Number(e.target.value) })
            }
          />
        </label>
        <label>
          Currency
          <select
            value={brief.currency}
            onChange={(e) =>
              setBrief({ ...brief, currency: e.target.value as "USD" | "EUR" })
            }
          >
            <option>USD</option>
            <option>EUR</option>
          </select>
        </label>
        <label>
          Funding structure
          <select
            value={brief.funding_structure}
            onChange={(e) =>
              setBrief({
                ...brief,
                funding_structure: e.target.value as "staged" | "upfront",
              })
            }
          >
            <option value="staged">Pilot, then staged investment</option>
            <option value="upfront">Full investment upfront</option>
          </select>
        </label>
        <label className="full">
          What should the audience remember?
          <textarea
            maxLength={2000}
            rows={3}
            value={brief.emphasis}
            onChange={(e) => setBrief({ ...brief, emphasis: e.target.value })}
          />
        </label>
        <label className="full">
          Constraints and questions to resolve
          <textarea
            maxLength={2000}
            rows={3}
            value={brief.constraints}
            onChange={(e) =>
              setBrief({ ...brief, constraints: e.target.value })
            }
          />
        </label>
      </div>
      <details className="financial-inputs" open={demo}>
        <summary>Investment and return assumptions</summary>
        <p>
          Amounts use {brief.currency}. Changing the currency does not convert
          amounts. Leave unverified inputs blank. Benefits count once across the
          portfolio.
        </p>
        <div className="financial-fields">
          {fields.map(({ key, label, rate, index }) => {
            const item =
              index === undefined
                ? (brief.financials[key] as FinancialInput)
                : brief.financials.adoption[index];
            return (
              <fieldset key={`${key}-${index ?? ""}`}>
                <legend>{label}</legend>
                <input
                  aria-label={label}
                  type="number"
                  step="any"
                  min={0}
                  max={rate ? 100 : undefined}
                  value={
                    item.value === null
                      ? ""
                      : Number((item.value * (rate ? 100 : 1)).toFixed(8))
                  }
                  placeholder="Unknown"
                  onChange={(e) => {
                    const value =
                      e.target.value === ""
                        ? null
                        : Number(e.target.value) / (rate ? 100 : 1);
                    financial(key, index, {
                      value,
                      origin:
                        value === null
                          ? "unknown"
                          : item.origin === "unknown"
                            ? "pm_estimate"
                            : item.origin,
                      reference:
                        value === null
                          ? ""
                          : item.reference ||
                            "PM estimate; validate with Finance",
                    });
                  }}
                />
                <select
                  aria-label={`${label} provenance`}
                  value={item.origin}
                  onChange={(e) =>
                    financial(key, index, {
                      ...item,
                      origin: e.target.value as FinancialInput["origin"],
                      ...(e.target.value === "unknown"
                        ? { value: null, reference: "" }
                        : {}),
                    })
                  }
                >
                  <option value="unknown">Unknown</option>
                  <option value="pm_estimate">PM estimate</option>
                  <option value="sourced">Sourced</option>
                  {demo ? (
                    <option value="synthetic">Synthetic fixture</option>
                  ) : null}
                </select>
                <input
                  aria-label={`${label} source or rationale`}
                  value={item.reference}
                  placeholder="Source or estimate rationale"
                  maxLength={1000}
                  onChange={(e) =>
                    financial(key, index, {
                      ...item,
                      reference: e.target.value,
                    })
                  }
                />
              </fieldset>
            );
          })}
        </div>
        <p className="small muted">
          Three years of incremental contribution. Downside adoption is 70% of
          base, upside is 120%, capped at 100%. Development is paid in year one
          and rollout in year two. Tax and terminal value are excluded.
        </p>
      </details>
      <Button type="submit" disabled={disabled}>
        Save brief & review outline
      </Button>
      <p className="small muted">
        Changing this brief preserves earlier decks in history and requires a
        fresh outline review.
      </p>
    </form>
  );
}
