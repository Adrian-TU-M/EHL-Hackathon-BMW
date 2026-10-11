import type {
  SlideContent,
  SlideContentItem,
} from "../../lib/presentation/contracts";

type Field = [keyof SlideContentItem, string, number];
const fields: Record<SlideContent["kind"], Field[]> = {
  problem: [
    ["label", "Customer need", 60],
    ["detail", "Observed friction", 130],
  ],
  portfolio: [
    ["label", "Requirement", 60],
    ["detail", "Intended outcome", 130],
  ],
  journey: [
    ["label", "Journey step", 60],
    ["detail", "Intended experience", 130],
  ],
  evidence: [
    ["detail", "Source quotation", 130],
    ["condition", "Evidence limitation", 100],
  ],
  comparison: [
    ["label", "Option", 60],
    ["detail", "Approach", 130],
    ["condition", "Tradeoff", 100],
  ],
  responsibilities: [
    ["label", "Department", 60],
    ["detail", "Responsibility", 130],
    ["dependency", "Dependency", 100],
    ["owner", "Owner", 45],
  ],
  roadmap: [
    ["label", "Milestone", 60],
    ["detail", "Validation activity", 130],
    ["timing", "Timing", 40],
    ["owner", "Owner", 45],
    ["condition", "Release gate", 100],
  ],
  risks: [
    ["detail", "Objection / consequence", 130],
    ["dependency", "Mitigation", 100],
    ["condition", "Stop condition", 100],
  ],
};

export function StructuredSlideEditor({
  content,
  onChange,
}: {
  content: SlideContent;
  onChange: (content: SlideContent) => void;
}) {
  return (
    <div className="structured-slide-editor">
      {content.items.map((item, index) => (
        <fieldset key={index}>
          <legend>
            {content.kind === "evidence" ? "Evidence" : "Item"} {index + 1}
          </legend>
          {fields[content.kind].map(([key, label, maxLength]) => (
            <label key={key}>
              {label}
              <textarea
                aria-label={`${label} ${index + 1}`}
                value={item[key]}
                maxLength={maxLength}
                rows={2}
                readOnly={content.kind === "evidence" && key === "detail"}
                onChange={(e) =>
                  onChange({
                    ...content,
                    items: content.items.map((row, i) =>
                      i === index ? { ...row, [key]: e.target.value } : row,
                    ),
                  })
                }
              />
            </label>
          ))}
          {item.source_id && (
            <small>
              Frozen source: {item.source_id}. Quote wording is protected.
            </small>
          )}
        </fieldset>
      ))}
      <p className="small muted">
        Keep fields concise. Longer explanation belongs in speaker notes; the
        slide preview reports content that does not fit.
      </p>
    </div>
  );
}
