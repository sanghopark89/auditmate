// 계획 작업 16 / 설계 §5.4 — 진행 막대: % 와 현재 단계 이름
import type { RunProgress, RunStage } from "@/lib/audit/pipeline";

// 단계별로 막대에서 차지하는 구간(%). AI 분류가 가장 오래 걸려 가장 넓게 잡았다
const STAGE_RANGE: Record<RunStage, [number, number]> = {
  match: [0, 10],
  select: [10, 15],
  mask: [15, 25],
  classify: [25, 90],
  judge: [90, 100],
  done: [100, 100],
};

const STAGE_LABEL: Record<RunStage, string> = {
  match: "짝짓는 중",
  select: "최근 실태조사 고르는 중",
  mask: "개인정보 가리는 중",
  classify: "AI 분류 중",
  judge: "판정 중",
  done: "점검 완료",
};

/** 진행 상황을 0~100 %로 바꾼다 (AI 분류 단계는 끝난 문장 수 비율로 구간 안을 채운다) */
export function progressPercent(p: RunProgress): number {
  const [from, to] = STAGE_RANGE[p.stage];
  if (p.stage !== "classify" || p.total <= 0) return from;
  return Math.round(from + ((to - from) * Math.min(p.done, p.total)) / p.total);
}

export function progressLabel(p: RunProgress): string {
  const label = STAGE_LABEL[p.stage];
  return p.stage === "classify" && p.total > 0
    ? `${label} ${p.done.toLocaleString("ko-KR")}/${p.total.toLocaleString("ko-KR")}`
    : label;
}

export default function ProgressBar({ progress, note }: { progress: RunProgress; note?: string | null }) {
  const percent = progressPercent(progress);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span>{progressLabel(progress)}</span>
        <span className="font-semibold tabular-nums">{percent}%</span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label="점검 진행률"
        className="mt-2 h-3 w-full overflow-hidden rounded-full bg-foreground/15"
      >
        <div className="h-full rounded-full bg-foreground transition-[width] duration-300" style={{ width: `${percent}%` }} />
      </div>
      {note && <p className="mt-2 text-sm text-foreground/70">{note}</p>}
    </div>
  );
}
