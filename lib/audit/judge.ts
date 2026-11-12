// 계획 작업 13 / 설계 §3.3 — 판정 규칙: 점검결과와 판정사유 만들기
//
// 지금까지 모은 것(짝짓기, 고른 이용현황, 가린 문장, 가설 건축물 낱말, 문장 분류)을 합쳐
// 대부계약 행마다 점검결과(정상 / 부적정 / 검토 필요 / 대조 불가)와 50자 이내 판정사유를 만든다.
// AI는 문장을 분류하는 일까지만 맡고, 최종 판정은 이 파일의 규칙이 한다(PRD 5번).
// 화면·서버와 무관한 순수 규칙이라 AI 없이도 그대로 시험할 수 있다.
//
// 판정표 (위에서부터 보고, 처음 맞는 조건 하나로 정한다)
//   1. 대장번호가 비어 있음                       → 대조 불가
//   2. 같은 대장번호의 실태조사가 없음            → 대조 불가
//   3. 고른 실태조사의 이용현황이 비어 있음       → 대조 불가
//   4. 대부목적을 5가지 분류로 맞출 수 없음       → 검토 필요
//   5. 이용현황에 가설 건축물 낱말이 있음         → 검토 필요
//   6. 분류가 "판단 불가"                        → 검토 필요
//   7. 분류가 대부목적 분류와 다름                → 부적정
//   8. 분류가 대부목적 분류와 같음                → 정상
//      (이용현황에 용도가 여럿 섞여 분류가 "농업용+주거용"처럼 둘 이상이면, 대부목적이 그중 하나라도 있으면 정상)
// 상세용도는 판정에 쓰지 않고 판정사유에 괄호로 참고로만 적는다(사용자 결정).

import { REASON_MAX_LENGTH, UNDECIDABLE, classificationParts, resolvePurposeCategory, tidyText } from "./checkset";
import type { AiCategory, CheckResult, UseCategory } from "./checkset";
import { cellAt } from "./detect";
import type { TableLayout } from "./detect";
import type { LatestPick, MatchResult } from "./match";
import type { SentenceSet } from "./mask";
import type { CellValue } from "./read-file";

// ─────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────

/** 대부계약 행 하나의 판정 */
export interface Verdict {
  /** 대부계약 표(rows)에서 이 행의 위치 (0부터) */
  leaseRowIndex: number;
  result: CheckResult;
  /** 판정사유 (50자 이내, 이름·번호를 가린 문장 기준) */
  reason: string;
  /** 어느 판정표 규칙(1~8)으로 정해졌는지. 요약·유형별 집계에 쓴다 */
  rule: number;
}

export interface JudgeInput {
  leaseRows: CellValue[][];
  leaseLayout: TableLayout;
  match: MatchResult;
  /** selectLatestSurveys의 결과(picks). match.entries와 같은 순서·같은 수 */
  picks: LatestPick[];
  /** buildSentenceSet의 결과 (가린 문장, 가설 건축물 낱말) */
  sentences: SentenceSet;
  /**
   * 문장 번호별 분류. 대응표(applyMapping)와 AI(classifyPending)의 결과를 합친 것이어야 한다.
   * 이용현황이 있는 행이 쓰는 문장은 모두 채워져 있어야 하고, 하나라도 null이면 오류를 던진다
   * (분류가 빠진 채 판정해서 거짓 결과가 나오는 것을 막기 위해).
   */
  categories: readonly (AiCategory | null)[];
}

export interface JudgeResult {
  /** 대부계약 데이터 행마다 하나씩 (match.entries와 같은 순서) */
  verdicts: Verdict[];
  /** 점검결과별 행 수 */
  counts: Record<CheckResult, number>;
  /** 규칙 번호(1~8)별 행 수 */
  ruleCounts: Record<number, number>;
}

// ─────────────────────────────────────────────────────────────
// 판정사유 만들기 (50자 이내)
// ─────────────────────────────────────────────────────────────

/** 글자 수를 센다 (이모지 같은 글자 쌍도 한 글자로) */
const lengthOf = (text: string): number => Array.from(text).length;

/** text를 max글자로 줄인다. 줄이면 끝에 …을 붙인다 (… 포함 max글자) */
function clip(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  if (max <= 1) return "…".slice(0, Math.max(0, max));
  return `${chars.slice(0, max - 1).join("")}…`;
}

/** 문장을 가린 문장에서 따와 남은 자리에 맞게 줄인다. 자리가 너무 좁으면 3글자도 못 쓸 수 있다 */
const MIN_HEAD = 6;

/**
 * "앞부분 + 따옴표 안의 문장 + 뒷부분" 모양의 판정사유를 50자에 맞춘다.
 * 문장이 너무 길면 문장을 줄이고, 그래도 자리가 모자라면(앞부분·뒷부분이 너무 길 때)
 * 앞부분 후보를 차례로 시도한다. 마지막 후보는 문장 없이 앞부분만 적는다.
 */
function fitReason(prefixes: readonly string[], sentence: string, suffix: string): string {
  for (const prefix of prefixes) {
    const room = REASON_MAX_LENGTH - lengthOf(prefix) - lengthOf(suffix) - 2; // 따옴표 2개
    if (room >= MIN_HEAD || (room >= 1 && prefix === prefixes[prefixes.length - 1])) {
      return `${prefix}'${clip(sentence, room)}'${suffix}`;
    }
  }
  const last = prefixes[prefixes.length - 1];
  return clip(`${last}${suffix}`, REASON_MAX_LENGTH);
}

/** 대부목적 이름표: "농업용(밭)". 상세용도가 없으면 분류만 */
function purposeLabel(category: UseCategory, detail: string, withDetail: boolean): string {
  return withDetail && detail !== "" ? `${category}(${detail})` : category;
}

// ─────────────────────────────────────────────────────────────
// 판정
// ─────────────────────────────────────────────────────────────

function columnOf(layout: TableLayout, name: string): number {
  const index = layout.columnIndex[tidyText(name)];
  if (index === undefined) throw new Error(`${name} 열을 찾을 수 없습니다`);
  return index;
}

const textOf = (value: CellValue | undefined): string =>
  typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";

/** 대부계약 행마다 점검결과와 판정사유를 만든다. 판정표(§3.3)를 위에서부터 보고 처음 맞는 규칙으로 정한다 */
export function judgeAll(input: JudgeInput): JudgeResult {
  const { leaseRows, leaseLayout, match, picks, sentences, categories } = input;
  if (match.entries.length !== picks.length) throw new Error("짝짓기 결과와 고른 실태조사의 수가 다릅니다");
  const purposeColumn = columnOf(leaseLayout, "대부목적");
  const detailColumn = columnOf(leaseLayout, "상세용도");

  const verdicts: Verdict[] = new Array(picks.length);
  const counts: Record<CheckResult, number> = { 정상: 0, 부적정: 0, "검토 필요": 0, "대조 불가": 0 };
  const ruleCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0 };

  for (let i = 0; i < picks.length; i++) {
    const pick = picks[i];
    const leaseRowIndex = pick.leaseRowIndex;
    let result: CheckResult;
    let reason: string;
    let rule: number;

    if (pick.status === "blank-ledger") {
      [result, reason, rule] = ["대조 불가", "대장번호 없음", 1];
    } else if (pick.status === "no-survey") {
      [result, reason, rule] = ["대조 불가", "실태조사 내역에 대장번호 없음", 2];
    } else if (pick.status === "empty-usage") {
      [result, reason, rule] = ["대조 불가", "실태조사 내용 없음", 3];
    } else {
      // 이용현황이 있는 행: 대부목적을 5분류로 맞추고, 가린 문장과 분류를 찾아온다
      const row = leaseRows[leaseRowIndex];
      const purposeText = textOf(cellAt(row, purposeColumn));
      const detail = textOf(cellAt(row, detailColumn));
      const purpose = resolvePurposeCategory(purposeText);
      const sentenceId = sentences.sentenceIdByPick[i];
      const sentence = sentences.sentences[sentenceId];

      if (purpose === null) {
        const what = purposeText === "" ? "대부목적 칸이 비어 있음" : `대부목적 '${clip(purposeText, 20)}' 분류 불가`;
        [result, reason, rule] = ["검토 필요", clip(what, REASON_MAX_LENGTH), 4];
      } else {
        const temporaryWord = sentences.temporaryWord[sentenceId];
        const category = categories[sentenceId];
        if (category === null || category === undefined) {
          throw new Error("분류가 빠진 문장이 있습니다. 대응표와 AI 분류를 모두 채운 뒤 판정해야 합니다");
        }
        if (temporaryWord) {
          [result, reason, rule] = ["검토 필요", fitReason([`가설 건축물 언급(${temporaryWord}): `, "가설 건축물 언급: "], sentence, ""), 5];
        } else if (category === UNDECIDABLE) {
          [result, reason, rule] = ["검토 필요", fitReason(["이용현황 판단 어려움: "], sentence, ""), 6];
        } else if (!classificationParts(category).includes(purpose)) {
          // 대부목적 {분류(상세용도)} ↔ 현황 '문장'(분류)
          const withDetail = `대부목적 ${purposeLabel(purpose, detail, true)} ↔ 현황 `;
          const withoutDetail = `대부목적 ${purpose} ↔ 현황 `;
          [result, reason, rule] = ["부적정", fitReason([withDetail, withoutDetail], sentence, `(${category})`), 7];
        } else {
          const withDetail = `대부목적 ${purposeLabel(purpose, detail, true)} = 현황 `;
          const withoutDetail = `대부목적 ${purpose} = 현황 `;
          [result, reason, rule] = ["정상", fitReason([withDetail, withoutDetail], sentence, `(${category})`), 8];
        }
      }
    }
    verdicts[i] = { leaseRowIndex, result, reason, rule };
    counts[result]++;
    ruleCounts[rule]++;
  }
  return { verdicts, counts, ruleCounts };
}
