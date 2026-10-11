import type { CSSProperties } from "react";
import "../../styles/jury-avatar.css";

const expressions = {
  affectionate: { emoji: "💙", label: "Appreciative" },
  confident: { emoji: "✨", label: "Confident" },
  calm: { emoji: "😌", label: "Ready" },
  curious: { emoji: "👂", label: "Listening" },
  thoughtful: { emoji: "🤔", label: "Considering" },
  warm: { emoji: "😊", label: "Encouraging" },
  excited: { emoji: "✨", label: "Inspired" },
  concerned: { emoji: "🧐", label: "Looking closer" },
  surprised: { emoji: "💡", label: "New perspective" },
  reassuring: { emoji: "💙", label: "Reassuring" },
  engaged: { emoji: "💬", label: "Explaining" },
} as const;
type Expression = keyof typeof expressions;

// Explicit delivery tags take priority; keyword cues are only visual hints.
function replyExpression(text: string): Expression {
  const tag = text.match(/\[([^\]]+)\]/)?.[1] || "";
  const classify = (value: string): Expression | undefined => {
    if (
      /\b(love|lovely|grateful|affectionate|appreciate|thank you|kind words)\b/i.test(
        value,
      )
    )
      return "affectionate";
    if (
      /\b(confident|cool|awesome|absolutely|great job|well done|nailed it)\b/i.test(
        value,
      )
    )
      return "confident";
    if (/\b(excited|enthusiastic|delighted|inspired)\b/i.test(value))
      return "excited";
    if (/\b(surprised|surprising|unexpected|discovery)\b/i.test(value))
      return "surprised";
    if (
      /\b(reassuring|empathetic|understand|understandable|perfectly fine)\b/i.test(
        value,
      )
    )
      return "reassuring";
    if (/\b(concerned|caution|risk|warning|unsafe)\b/i.test(value))
      return "concerned";
    if (
      /\b(thoughtful|serious|uncertain|trade.off|unknown|not enough)\b/i.test(
        value,
      )
    )
      return "thoughtful";
    if (
      /\b(cheerful|happy|warm|benefit|recommend|support|improve|agree|promising|opportunity)\b/i.test(
        value,
      )
    )
      return "warm";
    if (/\b(calm|gentle|relaxed)\b/i.test(value)) return "calm";
  };
  return classify(tag) || classify(text) || "engaged";
}

// Visual expression cues only: these do not change the Judge's reasoning or verdict.
export function JuryAvatar({
  speaking,
  listening,
  thinking,
  text,
  energy,
  label,
}: {
  speaking: boolean;
  listening: boolean;
  thinking: boolean;
  text: string;
  energy: number;
  label: string;
}) {
  const expression: Expression = thinking
    ? "thoughtful"
    : speaking
      ? replyExpression(text)
      : listening
        ? "curious"
        : "calm";
  const mood = expressions[expression];
  return (
    <div
      className={`jury-avatar-stage ${speaking ? "is-speaking" : ""} ${listening ? "is-listening" : ""}`}
      style={
        { "--voice-energy": Math.max(0, Math.min(1, energy)) } as CSSProperties
      }
    >
      <div className="jury-avatar-float">
        <div
          key={expression}
          className={`jury-expression-badge mood-${expression}`}
          role="img"
          aria-label={`Expression: ${mood.label}`}
        >
          <span className="jury-expression-emoji" aria-hidden="true">
            {mood.emoji}
          </span>
        </div>
        {(expression === "affectionate" ||
          expression === "reassuring" ||
          expression === "warm") && (
          <div className="jury-floating-hearts" aria-hidden="true">
            <span>💙</span>
            <span>🤍</span>
            <span>💙</span>
          </div>
        )}
        <div
          className={`jury-avatar expression-${expression}`}
          role="img"
          aria-label={label}
        >
          <div className="jury-avatar-colors" />
          <div className="jury-avatar-tint" />
          <div className="jury-avatar-texture" />
          <div className="jury-avatar-reflection" />
          <div className="jury-avatar-face" aria-hidden="true">
            <span className="jury-brow left" />
            <span className="jury-brow right" />
            <span className="jury-eye left" />
            <span className="jury-eye right" />
            <span className="jury-mouth" />
          </div>
        </div>
      </div>
      <div className="jury-avatar-shadow" aria-hidden="true" />
      <strong>{label}</strong>
      <span>
        {speaking
          ? "A perspective, with your decision at its heart."
          : listening
            ? "I'm listening. Take your time."
            : thinking
              ? "Connecting to your Judge…"
              : "Your council. A conversation away."}
      </span>
    </div>
  );
}
