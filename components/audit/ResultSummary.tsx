// 계획 작업 22 (nice) / 설계 §5.4 — 결과 요약과 유형별 집계
// 요약: 전체·정상·부적정·검토 필요·대조 불가 건수. 집계: 부적정은 실제 이용 분류별, 검토 필요·대조 불가는 사유별.

import type { CheckResult } from "@/lib/audit/checkset";

interface Props {
  total: number;
  counts: Record<CheckResult, number>;
  ruleCounts: Record<number, number>;
  violationByCategory: Record<string, number>;
  /** 오프라인 모드로 돌렸는지 (검토 필요 사유의 이름이 달라진다) */
  offline?: boolean;
}

const fmt = (n: number) => n.toLocaleString("ko-KR");

// 판정표 규칙 번호 → 사유 이름 (설계 §3.3)
const REVIEW_REASONS: [number, string][] = [
  [4, "대부목적을 분류할 수 없음"],
  [5, "가설 건축물 언급"],
  [6, "이용현황을 AI가 판단하지 못함"],
];
const UNMATCHED_REASONS: [number, string][] = [
  [1, "대장번호 없음"],
  [2, "실태조사 내역에 대장번호 없음"],
  [3, "실태조사 이용현황 없음"],
];

function Breakdown({ title, items }: { title: string; items: [string, number][] }) {
  const shown = items.filter(([, n]) => n > 0);
  return (
    <div className="rounded-md border border-foreground/15 p-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {shown.length === 0 ? (
        <p className="mt-2 text-sm text-foreground/60">해당 건이 없습니다.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm">
          {shown.map(([label, n]) => (
            <li key={label} className="flex justify-between gap-3">
              <span>{label}</span>
              <span className="tabular-nums">{fmt(n)}건</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ResultSummary({ total, counts, ruleCounts, violationByCategory, offline }: Props) {
  const reviewReasons = REVIEW_REASONS.map(([rule, label]): [number, string] => [rule, offline && rule === 6 ? "판단 불가 이용현황 (대응표에 없거나 판단 불가)" : label]);
  const tiles: [CheckResult | "전체", number][] = [
    ["전체", total],
    ["정상", counts["정상"]],
    ["부적정", counts["부적정"]],
    ["검토 필요", counts["검토 필요"]],
    ["대조 불가", counts["대조 불가"]],
  ];
  return (
    <div className="mt-3" data-testid="result-summary">
      <p className="text-sm">
        전체 {fmt(total)}건 중 부적정 {fmt(counts["부적정"])}건, 검토 필요 {fmt(counts["검토 필요"])}건
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {tiles.map(([label, n]) => (
          <div key={label} className="rounded-md border border-foreground/15 px-3 py-2">
            <dt className="text-xs text-foreground/60">{label}</dt>
            <dd className="text-lg font-semibold tabular-nums">{fmt(n)}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <Breakdown title="부적정: 실제 이용 분류별" items={Object.entries(violationByCategory).sort((a, b) => b[1] - a[1])} />
        <Breakdown title="검토 필요: 사유별" items={reviewReasons.map(([rule, label]) => [label, ruleCounts[rule] ?? 0])} />
        <Breakdown title="대조 불가: 사유별" items={UNMATCHED_REASONS.map(([rule, label]) => [label, ruleCounts[rule] ?? 0])} />
      </div>
    </div>
  );
}
