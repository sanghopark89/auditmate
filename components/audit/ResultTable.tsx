"use client";

// 계획 작업 18 / 설계 §5.4 — 결과 목록: 부적정 / 검토 필요 / 대조 불가 보기 전환, 한 쪽 100건
// 소재지·대부요율은 대부계약 현황 파일의 값이다. 고객명은 가운데 글자를 가렸고(홍*동) 이용현황은 이름·번호를 가린 문장이다. 목록은 작업자가 만들어 보내 준다.

import { useEffect, useState } from "react";
import type { CheckResult } from "@/lib/audit/checkset";
import type { ResultFilter, ResultPage } from "@/lib/audit/pipeline";
import NoticeBox from "./NoticeBox";

const FILTERS: ResultFilter[] = ["부적정", "검토 필요", "대조 불가"];

interface Props {
  counts: Record<CheckResult, number>;
  /** 한 쪽을 받아 오는 함수 (작업자에게 묻는다) */
  load: (filter: ResultFilter, page: number) => Promise<ResultPage>;
}

const fmt = (n: number) => n.toLocaleString("ko-KR");

export default function ResultTable({ counts, load }: Props) {
  // 건수가 있는 첫 보기로 시작한다 (모두 0이면 부적정)
  const [filter, setFilter] = useState<ResultFilter>(FILTERS.find((f) => counts[f] > 0) ?? "부적정");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ResultPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    load(filter, page)
      .then((next) => {
        if (cancelled) return;
        setData(next);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "결과 목록을 불러오지 못했습니다");
      });
    return () => {
      cancelled = true;
    };
  }, [filter, page, load]);

  const showing = data && data.filter === filter ? data : null;

  return (
    <div className="mt-5">
      <div role="tablist" aria-label="결과 보기" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={f === filter}
            onClick={() => {
              setFilter(f);
              setPage(1);
            }}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              f === filter ? "border-foreground bg-foreground text-background" : "border-foreground/30 hover:bg-foreground/5"
            }`}
          >
            {f} {fmt(counts[f])}건
          </button>
        ))}
      </div>

      {error && (
        <div className="mt-3">
          <NoticeBox tone="error">{error}</NoticeBox>
        </div>
      )}

      {showing && showing.total === 0 && (
        <p className="mt-3 rounded-md border border-dashed border-foreground/20 px-4 py-4 text-center text-sm text-foreground/60">
          {filter} 건이 없습니다.
        </p>
      )}

      {showing && showing.total > 0 && (
        <>
          <div className="mt-3 overflow-x-auto rounded-xl border border-foreground/15">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <thead className="bg-foreground text-white">
                <tr>
                  {["소재지", "고객명", "대부목적", "상세용도", "대부요율", "이용현황(이름 가림)", "점검결과", "판정사유"].map((h) => (
                    <th key={h} scope="col" className="whitespace-nowrap px-3 py-2 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {showing.rows.map((r, i) => (
                  <tr key={`${r.ledger}-${i}`} className="border-t border-foreground/10 align-top">
                    <td className="px-3 py-2">{r.location}</td>
                    <td className="whitespace-nowrap px-3 py-2">{r.customer}</td>
                    <td className="px-3 py-2">{r.purpose}</td>
                    <td className="px-3 py-2">{r.detail}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{r.rate}</td>
                    <td className="max-w-xs px-3 py-2 break-words">{r.usage}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-medium">{r.result}</td>
                    <td className="px-3 py-2">{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-foreground/70">
              {fmt((showing.page - 1) * showing.pageSize + 1)}–{fmt((showing.page - 1) * showing.pageSize + showing.rows.length)} / {fmt(showing.total)}건
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={showing.page <= 1}
                onClick={() => setPage(showing.page - 1)}
                className="rounded-md border border-foreground/30 px-3 py-1 disabled:opacity-40"
              >
                이전
              </button>
              <span className="tabular-nums">
                {fmt(showing.page)} / {fmt(showing.pageCount)}쪽
              </span>
              <button
                type="button"
                disabled={showing.page >= showing.pageCount}
                onClick={() => setPage(showing.page + 1)}
                className="rounded-md border border-foreground/30 px-3 py-1 disabled:opacity-40"
              >
                다음
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
