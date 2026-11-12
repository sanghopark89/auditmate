// 계획 작업 5 / 설계 §2.2 ②·§3.4 — 제목 줄 찾기, 합계·빈 행 건너뛰기
//
// 읽어 둔 표(read-file.ts의 rows)에서
//   1) 필수 열 이름이 있는 줄을 제목 줄로 찾고,
//   2) 그 아래에서 실제 데이터 행만 골라낸다 (빈 행·합계 행·반복된 제목 줄은 건너뜀).
// 어떤 보고서인지 알아보기와 빠진 필수 열 확인은 작업 6이 같은 파일에 이어서 맡는다.
// 파일 읽기와 달리 화면·서버와 무관한 순수 규칙이라 그대로 시험할 수 있다.

import {
  ALL_REQUIRED_COLUMN_NAMES,
  DISTINGUISHING_COLUMNS,
  HEADER_MIN_MATCHES,
  HEADER_SCAN_ROWS,
  REPORT_NAMES,
  REQUIRED_COLUMNS,
  TOTAL_CELL_MAX_LENGTH,
  TOTAL_ROW_WORDS,
  UPLOAD_MESSAGES,
  tidyText,
} from "./checkset";
import type { ReportKind } from "./checkset";
import type { CellValue } from "./read-file";

// ─────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────

/** 건너뛴 행 수 (제목 줄 위의 행은 포함하지 않는다) */
export interface SkippedCounts {
  /** 모든 칸이 빈 행 */
  blank: number;
  /** 합계·소계·총계 행 */
  total: number;
  /** 쪽마다 다시 나오는 제목 줄 */
  repeatedHeader: number;
}

/** 제목 줄을 찾고 데이터 행을 골라낸 결과 */
export interface TableLayout {
  /** 제목 줄 위치 (rows 안에서 0부터) */
  headerRowIndex: number;
  /** 제목 줄 칸의 글자 (앞뒤 공백 제거). 칸 위치가 곧 열 위치다 */
  headers: string[];
  /** 정리된 열 이름(공백 제거) → 칸 위치. 같은 이름이 둘이면 앞의 것 */
  columnIndex: Record<string, number>;
  /** 데이터 행의 위치 목록 (rows 안에서 0부터, 위에서 아래 순서). 대장번호만 빈 행도 포함한다 */
  dataRowIndexes: number[];
  skipped: SkippedCounts;
}

// ─────────────────────────────────────────────────────────────
// 칸 도우미
// ─────────────────────────────────────────────────────────────

/** 칸 값을 글자로 본다. 글자가 아닌 칸(숫자·날짜 등)은 빈 글자 */
function textOf(value: CellValue | undefined): string {
  return typeof value === "string" ? value : "";
}

/** 칸이 비어 있는지: 값이 없거나 공백뿐인 글자. 숫자·날짜·참거짓은 비어 있지 않다 */
function isBlankCell(value: CellValue | undefined): boolean {
  if (value === undefined || value === null) return true;
  return typeof value === "string" && value.trim() === "";
}

/** 행에서 index번째 칸 값을 안전하게 꺼낸다 (행이 짧으면 빈 글자) */
export function cellAt(row: CellValue[], index: number): CellValue {
  return row[index] ?? "";
}

// 필수 열 이름을 비교용으로 정리해 둔다 (공백 제거, 한글 조합 통일)
const REQUIRED_KEYS: ReadonlySet<string> = new Set(
  ALL_REQUIRED_COLUMN_NAMES.map(tidyText),
);

/** 행에 들어 있는 서로 다른 필수 열 이름의 수 */
function countRequiredNames(row: CellValue[]): number {
  const found = new Set<string>();
  for (const cell of row) {
    const key = tidyText(textOf(cell));
    if (REQUIRED_KEYS.has(key)) found.add(key);
  }
  return found.size;
}

/** 합계 행인지: 짧은 칸(공백 뺀 10자 이하) 안에 합계·소계·총계 글자가 있으면 합계 행 */
function isTotalRow(row: CellValue[]): boolean {
  return row.some((cell) => {
    const text = tidyText(textOf(cell));
    return (
      text.length > 0 &&
      text.length <= TOTAL_CELL_MAX_LENGTH &&
      TOTAL_ROW_WORDS.some((word) => text.includes(word))
    );
  });
}

// ─────────────────────────────────────────────────────────────
// 제목 줄 찾기와 데이터 행 고르기
// ─────────────────────────────────────────────────────────────

/**
 * 제목 줄의 위치를 찾는다.
 * 맨 위 30줄 안에서, 필수 열 이름(대장번호·대부목적·상세용도·실태조사일자·이용현황)이
 * 서로 다른 것으로 2개 이상 들어 있는 줄 가운데 가장 위의 줄. 없으면 -1.
 */
export function findHeaderRowIndex(rows: CellValue[][]): number {
  const limit = Math.min(HEADER_SCAN_ROWS, rows.length);
  for (let i = 0; i < limit; i++) {
    if (countRequiredNames(rows[i]) >= HEADER_MIN_MATCHES) return i;
  }
  return -1;
}

/**
 * 표에서 제목 줄을 찾고, 그 아래의 데이터 행만 골라낸다.
 * 제목 줄을 못 찾으면 null (작업 6에서 "올바른 보고서가 아닙니다"로 안내한다).
 *
 * 건너뛰는 행 (결과 엑셀에는 그대로 남기고 점검결과 칸은 비운다):
 *  - 모든 칸이 빈 행
 *  - 합계·소계·총계 행
 *  - 쪽마다 다시 나오는 제목 줄 (제목 줄과 같은 필수 열 이름이 2개 이상 있는 행)
 * 대장번호만 빈 행은 건너뛰지 않는다 ("대조 불가(대장번호 없음)"으로 표시해야 하므로).
 */
export function locateTable(rows: CellValue[][]): TableLayout | null {
  const headerRowIndex = findHeaderRowIndex(rows);
  if (headerRowIndex < 0) return null;

  const headers = rows[headerRowIndex].map((cell) => textOf(cell).trim());
  const columnIndex: Record<string, number> = {};
  headers.forEach((header, index) => {
    const key = tidyText(header);
    if (key !== "" && !(key in columnIndex)) columnIndex[key] = index;
  });

  const dataRowIndexes: number[] = [];
  const skipped: SkippedCounts = { blank: 0, total: 0, repeatedHeader: 0 };
  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.every(isBlankCell)) skipped.blank++;
    else if (isTotalRow(row)) skipped.total++;
    else if (countRequiredNames(row) >= HEADER_MIN_MATCHES) skipped.repeatedHeader++;
    else dataRowIndexes.push(i);
  }
  return { headerRowIndex, headers, columnIndex, dataRowIndexes, skipped };
}

// ─────────────────────────────────────────────────────────────
// 보고서 종류 알아보기 (작업 6, 설계 §3.4)
// ─────────────────────────────────────────────────────────────

/** 파일 하나를 살펴본 결과 */
export interface ReportDetection {
  /** 알아본 보고서 종류. null이면 올바른 보고서가 아님 */
  kind: ReportKind | null;
  /** 제목 줄과 데이터 행. 제목 줄을 못 찾았으면 null */
  layout: TableLayout | null;
  /** 빠진 필수 열 이름 (kind를 알아본 경우에만 채워진다) */
  missingColumns: string[];
  /** 화면에 안내할 문구. 문제가 없으면 null */
  message: string | null;
}

/**
 * 읽어 둔 표가 어느 보고서인지 알아본다.
 * 제목 줄에 `대부목적`·`상세용도`가 있으면 대부계약 현황, `실태조사일자`·`이용현황`이 있으면
 * 실태조사 내역이다. 대장번호는 두 보고서에 모두 있어 판별에 쓰지 않는다.
 * 둘 다 있거나 둘 다 없으면 올바른 보고서가 아니다.
 * 종류를 알아봤으면 그 보고서의 필수 열 3개 가운데 빠진 열 이름을 함께 알려준다.
 */
export function detectReport(rows: CellValue[][]): ReportDetection {
  const layout = locateTable(rows);
  if (!layout) {
    return { kind: null, layout: null, missingColumns: [], message: UPLOAD_MESSAGES.notReport };
  }
  const has = (name: string) => tidyText(name) in layout.columnIndex;
  const looksLikeLease = DISTINGUISHING_COLUMNS.lease.some(has);
  const looksLikeSurvey = DISTINGUISHING_COLUMNS.survey.some(has);
  if (looksLikeLease === looksLikeSurvey) {
    return { kind: null, layout, missingColumns: [], message: UPLOAD_MESSAGES.notReport };
  }
  const kind: ReportKind = looksLikeLease ? "lease" : "survey";
  const missingColumns = REQUIRED_COLUMNS[kind].filter((name) => !has(name));
  return {
    kind,
    layout,
    missingColumns,
    message: missingColumns.length > 0 ? UPLOAD_MESSAGES.missingColumns(missingColumns) : null,
  };
}

// ─────────────────────────────────────────────────────────────
// 두 칸에 올린 파일 맞춰 보기 (작업 6, 설계 §6.1)
// ─────────────────────────────────────────────────────────────

/** 파일 칸 하나의 오류. clear가 true면 그 칸을 비운다 */
export interface SlotError {
  message: string;
  clear: boolean;
}

/** 올린 두 파일을 맞춰 본 결과 */
export interface UploadCheck {
  /** 종류별로 맞춘 파일 (칸이 바뀌어 있으면 바로잡은 뒤의 배정) */
  assigned: { lease: ReportDetection | null; survey: ReportDetection | null };
  /** 두 파일의 칸이 서로 바뀌어 있어 바로잡았는지 */
  swapped: boolean;
  /** 안내만 하는 문구 (칸을 바꿔 맞춤, 칸을 옮겨 맞춤) */
  notices: string[];
  /** 칸별 오류 (올린 칸 기준: leaseSlot = 대부계약 칸, surveySlot = 실태조사 칸) */
  slotErrors: { leaseSlot: SlotError | null; surveySlot: SlotError | null };
  /** 두 파일에 걸린 오류 (같은 종류의 보고서) */
  pairError: string | null;
  /** [점검 실행]을 누를 수 있는지: 두 보고서가 모두 알아봐지고 오류가 없을 때만 true */
  ready: boolean;
}

/** 칸 하나에 올린 파일의 오류 문구 (칸이 비었으면 null) */
function slotErrorOf(detection: ReportDetection | null): SlotError | null {
  if (!detection) return null;
  if (detection.kind === null) return { message: UPLOAD_MESSAGES.notReport, clear: true };
  if (detection.missingColumns.length > 0) {
    return { message: UPLOAD_MESSAGES.missingColumns(detection.missingColumns), clear: false };
  }
  return null;
}

/**
 * 대부계약 칸과 실태조사 칸에 올린 파일을 맞춰 본다 (각각 detectReport 결과, 비었으면 null).
 *  - 두 파일이 서로 칸이 바뀌어 있으면 바로잡고 안내만 한다.
 *  - 파일 하나만 올렸는데 다른 종류의 칸이면 맞는 칸으로 옮겨 맞추고 안내한다.
 *  - 두 칸이 같은 종류면 오류, 어느 보고서도 아니면 그 칸을 비운다.
 *  - 필수 열이 빠졌으면 빠진 열 이름을 알리고 [점검 실행]을 막는다.
 */
export function checkUploads(
  leaseSlot: ReportDetection | null,
  surveySlot: ReportDetection | null,
): UploadCheck {
  const slotErrors = {
    leaseSlot: slotErrorOf(leaseSlot),
    surveySlot: slotErrorOf(surveySlot),
  };
  const assigned: UploadCheck["assigned"] = { lease: null, survey: null };
  const notices: string[] = [];
  let swapped = false;
  let pairError: string | null = null;

  const leaseKind = leaseSlot?.kind ?? null;
  const surveyKind = surveySlot?.kind ?? null;

  if (leaseSlot && surveySlot && leaseKind && surveyKind) {
    if (leaseKind === surveyKind) {
      // 같은 종류가 두 칸에 올라옴: 어느 쪽을 쓸지 정할 수 없으니 배정하지 않는다
      pairError = UPLOAD_MESSAGES.sameKind;
    } else {
      swapped = leaseKind === "survey"; // 대부계약 칸에 실태조사가, 실태조사 칸에 대부계약이 올라옴
      assigned.lease = swapped ? surveySlot : leaseSlot;
      assigned.survey = swapped ? leaseSlot : surveySlot;
      if (swapped) notices.push(UPLOAD_MESSAGES.swapped);
    }
  } else {
    // 알아본 파일이 하나뿐: 종류에 맞는 자리에 둔다. 다른 칸에 올라와 있었다면 옮겼다고 안내한다
    if (leaseSlot && leaseKind) {
      assigned[leaseKind] = leaseSlot;
      if (leaseKind !== "lease") notices.push(UPLOAD_MESSAGES.movedToSlot(REPORT_NAMES[leaseKind]));
    }
    if (surveySlot && surveyKind) {
      assigned[surveyKind] = surveySlot;
      if (surveyKind !== "survey") notices.push(UPLOAD_MESSAGES.movedToSlot(REPORT_NAMES[surveyKind]));
    }
  }

  const ready =
    pairError === null &&
    slotErrors.leaseSlot === null &&
    slotErrors.surveySlot === null &&
    assigned.lease !== null &&
    assigned.survey !== null;
  return { assigned, swapped, notices, slotErrors, pairError, ready };
}
