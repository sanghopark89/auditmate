// 계획 작업 7 / 설계 §2.2 ④⑤·§3.3 — 대장번호로 두 보고서 짝짓기
//
// 대부계약 현황의 각 행에 대해, 같은 대장번호를 가진 실태조사 행을 모두 찾아 준다.
// 대장번호는 공백과 하이픈을 지운 뒤 비교한다 (DJ-2024-00001 = DJ 2024 00001 = DJ202400001).
//
// 이 파일이 하는 일
//  - 작업 7: 짝 찾기. 각 행이 "대장번호 없음 / 실태조사 없음 / 짝 있음" 중 어느 쪽인지 알려 준다.
//  - 작업 8: 짝이 여러 건이면 실태조사일자가 가장 최근인 1건을 고르고(날짜 읽기 규칙 포함),
//           고른 행의 이용현황이 비었는지 알아본다.
// 점검결과("대조 불가" 등)와 판정사유를 정하는 일은 판정 규칙(작업 13)이 맡는다.

import { tidyText } from "./checkset";
import { cellAt } from "./detect";
import type { TableLayout } from "./detect";
import type { CellValue } from "./read-file";

// ─────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────

/** 대부계약 행의 짝짓기 결과 */
export type MatchStatus =
  | "blank-ledger" // 대장번호 칸이 비어 있음
  | "no-survey" // 같은 대장번호의 실태조사가 없음
  | "matched"; // 실태조사가 1건 이상 있음

export interface MatchEntry {
  /** 대부계약 표(rows)에서 이 행의 위치 (0부터) */
  leaseRowIndex: number;
  /** 정리된 대장번호 (공백·하이픈 제거). 비었으면 빈 글자 */
  key: string;
  status: MatchStatus;
  /** 짝지은 실태조사 행의 위치 목록 (실태조사 표 rows 기준, 파일 위→아래 순서). 짝이 없으면 빈 목록 */
  surveyRowIndexes: readonly number[];
}

export interface MatchCounts {
  /** 대부계약 데이터 행 수 */
  leaseRows: number;
  /** 실태조사가 있는 행 */
  matched: number;
  /** 실태조사가 없는 행 */
  noSurvey: number;
  /** 대장번호가 빈 행 */
  blankLedger: number;
  /** 대부계약과 짝이 없어 쓰이지 않는 실태조사 행 (이 행들은 AI로 보내지 않는다) */
  unusedSurveyRows: number;
}

export interface MatchResult {
  /** 대부계약 데이터 행마다 하나씩, 파일 위→아래 순서 */
  entries: MatchEntry[];
  counts: MatchCounts;
}

// ─────────────────────────────────────────────────────────────
// 대장번호 정리
// ─────────────────────────────────────────────────────────────

// 하이픈 모양 글자: 보통 하이픈(-), 유니코드 하이픈·줄표(U+2010~2015), 마이너스(U+2212),
// 작은 하이픈(U+FE58, U+FE63), 전각 하이픈(U+FF0D)
const HYPHEN_LIKE = /[-‐-―−﹘﹣－]/g;

/**
 * 대장번호를 비교하기 좋게 정리한다: 모든 공백(전각 공백·줄바꿈 없는 공백 포함)과 하이픈을 지우고,
 * 한글 조합 방식을 통일한다. 숫자 칸은 글자로 바꾸고, 날짜·참거짓·빈 칸은 빈 글자가 된다.
 * 영문 대소문자는 같게 보지 않는다 (a-1과 A-1은 다른 번호).
 */
export function normalizeLedgerKey(value: CellValue | null | undefined): string {
  let text: string;
  if (typeof value === "string") text = value;
  else if (typeof value === "number") text = String(value);
  else return "";
  return text.normalize("NFC").replace(/\s+/g, "").replace(HYPHEN_LIKE, "");
}

/** 표 제목 줄에서 대장번호 열의 위치. 없으면 오류 (보고서 판별을 통과한 표에는 항상 있다) */
function ledgerColumnOf(layout: TableLayout): number {
  const index = layout.columnIndex[tidyText("대장번호")];
  if (index === undefined) throw new Error("대장번호 열을 찾을 수 없습니다");
  return index;
}

// ─────────────────────────────────────────────────────────────
// 짝짓기
// ─────────────────────────────────────────────────────────────

const NO_ROWS: readonly number[] = Object.freeze([]);

/**
 * 실태조사 표를 대장번호별로 묶어 둔다 (정리된 대장번호 → 행 위치).
 * 메모리를 아끼려고 행이 1건뿐이면 숫자 하나로, 여러 건이면 목록으로 담는다.
 * 대장번호가 빈 실태조사 행은 짝이 될 수 없으니 담지 않는다.
 */
function indexSurveyRows(
  rows: CellValue[][],
  layout: TableLayout,
): Map<string, number | number[]> {
  const column = ledgerColumnOf(layout);
  const byKey = new Map<string, number | number[]>();
  for (const rowIndex of layout.dataRowIndexes) {
    const key = normalizeLedgerKey(cellAt(rows[rowIndex], column));
    if (key === "") continue;
    const found = byKey.get(key);
    if (found === undefined) byKey.set(key, rowIndex);
    else if (typeof found === "number") byKey.set(key, [found, rowIndex]);
    else found.push(rowIndex);
  }
  return byKey;
}

/**
 * 대부계약 현황의 각 데이터 행에 같은 대장번호의 실태조사 행을 짝지어 준다.
 * 두 표 모두 detect.ts의 locateTable(또는 detectReport)로 제목 줄을 찾은 뒤의 것을 넣는다.
 */
export function matchReports(
  leaseRows: CellValue[][],
  leaseLayout: TableLayout,
  surveyRows: CellValue[][],
  surveyLayout: TableLayout,
): MatchResult {
  const byKey = indexSurveyRows(surveyRows, surveyLayout);
  const leaseColumn = ledgerColumnOf(leaseLayout);

  const entries: MatchEntry[] = [];
  const usedKeys = new Set<string>();
  let matched = 0;
  let noSurvey = 0;
  let blankLedger = 0;

  for (const leaseRowIndex of leaseLayout.dataRowIndexes) {
    const key = normalizeLedgerKey(cellAt(leaseRows[leaseRowIndex], leaseColumn));
    if (key === "") {
      blankLedger++;
      entries.push({ leaseRowIndex, key, status: "blank-ledger", surveyRowIndexes: NO_ROWS });
      continue;
    }
    const found = byKey.get(key);
    if (found === undefined) {
      noSurvey++;
      entries.push({ leaseRowIndex, key, status: "no-survey", surveyRowIndexes: NO_ROWS });
      continue;
    }
    matched++;
    usedKeys.add(key);
    entries.push({
      leaseRowIndex,
      key,
      status: "matched",
      surveyRowIndexes: typeof found === "number" ? [found] : found,
    });
  }

  // 대부계약에 쓰인 대장번호의 실태조사 행 수를 더해, 쓰이지 않은 행 수를 구한다
  let usedSurveyRows = 0;
  for (const key of usedKeys) {
    const found = byKey.get(key);
    usedSurveyRows += typeof found === "number" ? 1 : (found?.length ?? 0);
  }
  return {
    entries,
    counts: {
      leaseRows: entries.length,
      matched,
      noSurvey,
      blankLedger,
      unusedSurveyRows: surveyLayout.dataRowIndexes.length - usedSurveyRows,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// 실태조사일자 읽기 (작업 8, 설계 §3.4)
// ─────────────────────────────────────────────────────────────

/** 날짜가 실제로 있는 날인지 (2026-02-30 같은 날은 아님) 확인하고, 시간대와 무관한 숫자로 바꾼다 */
function dayNumber(year: number, month: number, day: number): number | null {
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const time = Date.UTC(year, month - 1, day);
  const check = new Date(time);
  // 31일이 없는 달에 31일을 쓰는 등 달력에 없는 날이면 날짜가 밀려서 값이 달라진다
  return check.getUTCMonth() === month - 1 && check.getUTCDate() === day ? time : null;
}

/**
 * 실태조사일자 칸을 날짜로 읽는다. 읽을 수 없거나 빈 칸이면 null (가장 오래된 것으로 취급한다).
 * 읽는 모양: 엑셀 날짜 칸, 20260512(글자 또는 숫자), 2026-05-12, 2026.05.12, 2026/05/12(월·일이 한 자리여도 됨),
 *          2026년 5월 12일, 뒤에 시각이 붙은 것(2026-05-12 14:30). 시각은 무시하고 날짜만 본다.
 * 반환값은 "그날 0시(UTC)"의 밀리초라서 서로 크기만 비교하면 된다.
 */
export function parseSurveyDate(value: CellValue | null | undefined): number | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    // 엑셀 날짜는 이 컴퓨터 시간대의 0시로 읽힌다. 시간대 때문에 날이 바뀌지 않게 지역 날짜를 쓴다
    return dayNumber(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  let text: string;
  if (typeof value === "number") text = String(value);
  else if (typeof value === "string") text = value.trim();
  else return null;

  // 20260512 (뒤에 시각이 붙은 202605121430, 20260512143000도 앞 8자리만 본다)
  let m = text.match(/^(\d{4})(\d{2})(\d{2})(?:\d{4}|\d{6})?$/);
  if (m) return dayNumber(+m[1], +m[2], +m[3]);
  // 2026-05-12 · 2026.05.12 · 2026/05/12 (+ 뒤에 시각)
  m = text.match(/^(\d{4})[-./]\s?(\d{1,2})[-./]\s?(\d{1,2})(?:[\sT].*)?$/);
  if (m) return dayNumber(+m[1], +m[2], +m[3]);
  // 2026년 5월 12일
  m = text.match(/^(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (m) return dayNumber(+m[1], +m[2], +m[3]);
  return null;
}

// ─────────────────────────────────────────────────────────────
// 가장 최근 실태조사 1건 고르기 (작업 8, 설계 §3.3·§3.4)
// ─────────────────────────────────────────────────────────────

/** 대부계약 행 하나에 쓸 실태조사를 고른 결과 */
export type PickStatus =
  | "blank-ledger" // 대장번호가 비어 있음 (짝짓기 결과 그대로)
  | "no-survey" // 같은 대장번호의 실태조사가 없음 (짝짓기 결과 그대로)
  | "empty-usage" // 고른 실태조사의 이용현황이 비어 있음
  | "ready"; // 고른 실태조사에 이용현황이 있어 다음 단계(문장 가리기·분류)로 넘어갈 수 있음

export interface LatestPick {
  /** 대부계약 표(rows)에서 이 행의 위치 (0부터) */
  leaseRowIndex: number;
  status: PickStatus;
  /** 고른 실태조사 행의 위치 (실태조사 표 rows 기준). 실태조사가 없으면 null */
  surveyRowIndex: number | null;
  /** 고른 행의 이용현황 글자 (앞뒤 공백을 지움). 고르지 못했으면 빈 글자 */
  usage: string;
}

export interface PickCounts {
  ready: number;
  emptyUsage: number;
  noSurvey: number;
  blankLedger: number;
  /** 실태조사가 2건 이상이라 날짜로 골라야 했던 대부계약 행 */
  chosenAmongMany: number;
}

export interface PickResult {
  /** 짝짓기 결과와 같은 순서·같은 수 */
  picks: LatestPick[];
  counts: PickCounts;
}

/** 표 제목 줄에서 열의 위치. 없으면 오류 (보고서 판별을 통과한 표에는 항상 있다) */
function columnOf(layout: TableLayout, name: string): number {
  const index = layout.columnIndex[tidyText(name)];
  if (index === undefined) throw new Error(`${name} 열을 찾을 수 없습니다`);
  return index;
}

/** 칸 값을 이용현황 글자로 본다 (앞뒤 공백을 지운다). 빈 칸은 빈 글자 */
function usageText(value: CellValue | undefined): string {
  if (value === undefined || value === null) return "";
  if (value instanceof Date) return ""; // 날짜 칸이 이용현황 자리에 있는 이상한 경우: 글로 보지 않는다
  return String(value).trim();
}

/**
 * 짝지은 실태조사 중에서 대부계약 행마다 가장 최근 1건을 고른다.
 *  - 실태조사일자가 가장 늦은 행을 고른다.
 *  - 날짜를 못 읽거나 빈 칸이면 가장 오래된 것으로 본다.
 *  - 날짜가 같으면 파일에서 더 아래에 있는 행을 고른다.
 *  - 고른 행의 이용현황이 비어 있으면 "empty-usage" (예전 조사에 내용이 있어도 최근 1건만 본다).
 * 대장번호가 빈 행과 실태조사가 없는 행은 짝짓기 결과 그대로 넘긴다.
 */
export function selectLatestSurveys(
  match: MatchResult,
  surveyRows: CellValue[][],
  surveyLayout: TableLayout,
): PickResult {
  const dateColumn = columnOf(surveyLayout, "실태조사일자");
  const usageColumn = columnOf(surveyLayout, "이용현황");

  // 같은 대장번호의 계약이 여러 행이면 같은 실태조사를 다시 계산하지 않도록 기억해 둔다
  const chosenByKey = new Map<string, number>();
  const picks: LatestPick[] = [];
  const counts: PickCounts = { ready: 0, emptyUsage: 0, noSurvey: 0, blankLedger: 0, chosenAmongMany: 0 };

  for (const entry of match.entries) {
    if (entry.status === "blank-ledger" || entry.status === "no-survey") {
      const blank = entry.status === "blank-ledger";
      if (blank) counts.blankLedger++;
      else counts.noSurvey++;
      picks.push({ leaseRowIndex: entry.leaseRowIndex, status: entry.status, surveyRowIndex: null, usage: "" });
      continue;
    }

    let chosen = chosenByKey.get(entry.key);
    if (chosen === undefined) {
      const candidates = entry.surveyRowIndexes;
      chosen = candidates[0];
      if (candidates.length > 1) {
        let bestTime = parseSurveyDate(cellAt(surveyRows[chosen], dateColumn)) ?? -Infinity;
        for (let i = 1; i < candidates.length; i++) {
          const time = parseSurveyDate(cellAt(surveyRows[candidates[i]], dateColumn)) ?? -Infinity;
          // >= 이라서 날짜가 같으면 아래 행이 이긴다
          if (time >= bestTime) {
            bestTime = time;
            chosen = candidates[i];
          }
        }
      }
      chosenByKey.set(entry.key, chosen);
    }
    if (entry.surveyRowIndexes.length > 1) counts.chosenAmongMany++;

    const usage = usageText(cellAt(surveyRows[chosen], usageColumn));
    const status: PickStatus = usage === "" ? "empty-usage" : "ready";
    if (status === "ready") counts.ready++;
    else counts.emptyUsage++;
    picks.push({ leaseRowIndex: entry.leaseRowIndex, status, surveyRowIndex: chosen, usage });
  }
  return { picks, counts };
}
