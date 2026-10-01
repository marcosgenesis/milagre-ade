import { useState } from "react";

export interface RecommendationOption {
  id: string;
  label: string;
  confidence: "high" | "medium" | "low";
}

interface RecommendationCardProps {
  question: string;
  options: RecommendationOption[];
  onSelect: (option: RecommendationOption) => void;
}

const CONFIDENCE_COPY: Record<RecommendationOption["confidence"], string> = {
  high: "High confidence",
  medium: "Needs review",
  low: "No signal",
};

function ConfidenceMeter({ confidence }: { confidence: RecommendationOption["confidence"] }) {
  const filled = confidence === "high" ? 3 : confidence === "medium" ? 2 : 1;
  return (
    <span className={`flex items-end gap-0.5 ${confidence === "high" ? "text-green" : confidence === "medium" ? "text-orange" : "text-ink-3"}`} aria-label={CONFIDENCE_COPY[confidence]}>
      {[0, 1, 2].map((bar) => <span key={bar} className="w-1 rounded-full bg-current" style={{ height: `${8 + bar * 3}px`, opacity: bar < filled ? 1 : 0.25 }} />)}
    </span>
  );
}

export function RecommendationCard({ question, options, onSelect }: RecommendationCardProps) {
  const [showAlternatives, setShowAlternatives] = useState(false);
  const recommendation = options[0];
  const alternatives = options.slice(1);
  if (!recommendation) return null;
  return (
    <section className="overflow-hidden rounded-card border border-line bg-surface shadow-card" aria-label="Agent recommendation">
      <div className="px-3.5 pb-3 pt-3">
        <p className="text-[13px] font-medium leading-5 text-ink">{question}</p>
        <button type="button" onClick={() => onSelect(recommendation)} className="mt-2.5 flex w-full items-start gap-2.5 rounded-control bg-inset px-2.5 py-2 text-left transition-colors hover:bg-hover">
          <ConfidenceMeter confidence={recommendation.confidence} />
          <span className="min-w-0 flex-1 text-[13px] leading-5 text-ink">{recommendation.label}</span>
          <span className="shrink-0 text-[11px] font-medium text-green">Recommended</span>
        </button>
      </div>
      {alternatives.length > 0 && (
        <div className="border-t border-line px-3.5 py-2.5">
          <div className="mb-1.5 text-[11px] font-medium text-ink-3">Other options</div>
          <div className="grid gap-1">
            {(showAlternatives ? alternatives : alternatives.slice(0, 2)).map((option) => (
              <button key={option.id} type="button" onClick={() => onSelect(option)} className="flex items-center gap-2.5 rounded-control px-1.5 py-1.5 text-left transition-colors hover:bg-hover">
                <ConfidenceMeter confidence={option.confidence} />
                <span className="min-w-0 flex-1 text-[13px] leading-5 text-ink-2">{option.label}</span>
                <span className="shrink-0 text-[11px] text-ink-3">{CONFIDENCE_COPY[option.confidence]}</span>
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-end gap-2">
            {alternatives.length > 2 && <button type="button" onClick={() => setShowAlternatives((current) => !current)} className="rounded-control border border-line bg-surface px-2.5 py-1.5 text-[12px] font-medium text-ink-2 hover:bg-hover">{showAlternatives ? "Hide alternatives" : "Alternatives"}</button>}
            <button type="button" onClick={() => onSelect(recommendation)} className="rounded-control bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90">Accept</button>
          </div>
        </div>
      )}
    </section>
  );
}

export function parseRecommendation(body: string): { question: string; options: RecommendationOption[] } | null {
  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const numbered = lines.map((line, index) => {
    const match = line.match(/^(\d+)[.)\-:]\s*(.+)$/);
    return match ? { index, number: Number(match[1]), label: match[2].trim() } : null;
  }).filter((option): option is { index: number; number: number; label: string } => Boolean(option));
  if (numbered.length < 2 || numbered.some((option, index) => option.number !== index + 1)) return null;
  const question = lines.slice(0, numbered[0].index).join(" ").replace(/[:\-]+$/, "").trim();
  if (!question) return null;
  return {
    question: question.endsWith("?") ? question : `${question}?`,
    options: numbered.map((option, index) => ({ id: `recommendation-${option.number}`, label: option.label, confidence: index === 0 ? "high" : index === 1 ? "medium" : "low" })),
  };
}
