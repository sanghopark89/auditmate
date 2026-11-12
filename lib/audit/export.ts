// 계획 작업 19 / 설계 §2.2 ⑪ — 결과 엑셀 만들기: 「대부계약 현황」 원본에 점검결과·판정사유 열만 덧붙인다
//
// 원칙(PRD must ②): 원본의 값(날짜·숫자 표시 형식 포함)·행 순서·행 수는 바꾸지 않고, 맨 오른쪽에 열 2개만 추가한다.
// 글꼴·색·칸 너비는 유지하지 않는다. 제목 줄 위의 행·합계 행에는 두 칸을 비워 둔다.
// 올린 파일이 엑셀이면 원본 파일을 다시 읽어(표시 형식 포함) 칸만 덧붙이고, CSV·TXT면 읽은 표에 열을 덧붙여 엑셀로 만든다.

import * as XLSX from "xlsx";
import { MAPPING_COLUMNS, RESULT_COLUMNS } from "./checkset";
import type { Verdict } from "./judge";
import { readTable } from "./read-file";

export interface ExportInput {
  /** 대부계약 원본 파일의 이름과 바이트 */
  source: { name: string; bytes: Uint8Array };
  /** 제목 줄의 위치 (읽은 표에서 0부터) */
  headerRowIndex: number;
  /** 행마다 판정 (leaseRowIndex는 읽은 표에서의 행 위치) */
  verdicts: readonly Verdict[];
  /** verdicts와 같은 순서: 점검에 쓴 실태조사의 이용현황 원문 (없으면 빈 글자) */
  surveyUsage: readonly string[];
}

/** 내려받을 파일 이름: 원본이름_점검결과.xlsx */
export function resultFileName(sourceName: string): string {
  const dot = sourceName.lastIndexOf(".");
  const base = dot > 0 ? sourceName.slice(0, dot) : sourceName;
  return `${base}_점검결과.xlsx`;
}

/** 결과 엑셀 파일의 내용(바이트)을 만든다 */
export function buildResultWorkbook(input: ExportInput): Uint8Array {
  const { source } = input;
  const isExcel = /\.(xlsx|xls)$/i.test(source.name);
  const workbook = isExcel ? appendToOriginalSheet(input) : buildFromTextTable(input);
  return new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx", cellDates: true }) as ArrayBuffer);
}

/** 엑셀 한 칸에 들어가는 글자 수 한도 (넘으면 파일이 깨지므로 끝을 자른다) */
const EXCEL_CELL_MAX = 32767;
const clipCell = <T>(text: T): T => (typeof text === "string" && text.length > EXCEL_CELL_MAX ? ((text.slice(0, EXCEL_CELL_MAX - 1) + "…") as T) : text);

/** 엑셀 한 시트의 최대 행 수 */
const EXCEL_MAX_ROWS = 1_048_576;

type DenseSheet = XLSX.WorkSheet & { "!data"?: (XLSX.CellObject | undefined)[][] };

/** 칸 하나를 글자로 적는다 (필요하면 행을 늘린다) */
function setText(data: (XLSX.CellObject | undefined)[][], row: number, col: number, text: string): void {
  while (data.length <= row) data.push([]);
  const line = data[row] ?? (data[row] = []);
  line[col] = { t: "s", v: clipCell(text) };
}

/** 엑셀 원본: 다시 읽어(날짜·숫자 표시 형식까지) 첫 시트의 맨 오른쪽에 두 열을 덧붙인다. 다른 시트는 그대로 둔다 */
function appendToOriginalSheet(input: ExportInput): XLSX.WorkBook {
  const workbook = XLSX.read(input.source.bytes, { type: "array", cellDates: true, cellNF: true, dense: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName] as DenseSheet;
  const data = sheet["!data"];
  if (!data) throw new Error("엑셀 시트를 읽지 못했습니다");

  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");
  // 읽은 표의 첫 행은 시트의 사용 범위 첫 행이다 (읽기 단계와 같은 기준)
  const firstRow = range.s.r;
  // 맨 오른쪽에 실태조사 이용현황 → 점검결과 → 판정사유 순으로 덧붙인다
  const usageCol = range.e.c + 1;
  const resultCol = range.e.c + 2;
  const reasonCol = range.e.c + 3;

  const headerRow = firstRow + input.headerRowIndex;
  setText(data, headerRow, usageCol, RESULT_COLUMNS.usage);
  setText(data, headerRow, resultCol, RESULT_COLUMNS.result);
  setText(data, headerRow, reasonCol, RESULT_COLUMNS.reason);
  input.verdicts.forEach((v, i) => {
    const row = firstRow + v.leaseRowIndex;
    setText(data, row, usageCol, input.surveyUsage[i] ?? "");
    setText(data, row, resultCol, v.result);
    setText(data, row, reasonCol, v.reason);
  });
  range.e.c = reasonCol;
  range.e.r = Math.max(range.e.r, data.length - 1);
  sheet["!ref"] = XLSX.utils.encode_range(range);
  return workbook;
}

/** CSV·TXT 원본: 읽은 표(글자 그대로)에 두 열을 덧붙여 새 엑셀을 만든다 */
function buildFromTextTable(input: ExportInput): XLSX.WorkBook {
  const table = readTable(input.source.bytes, input.source.name);
  if (table.rows.length > EXCEL_MAX_ROWS) {
    throw new Error("엑셀 한 시트의 최대 행 수(1,048,576)를 넘어 결과 엑셀을 만들 수 없습니다. 파일을 나누어 점검해 주세요");
  }
  const width = table.rows.reduce((max, r) => Math.max(max, r.length), 0);
  // 줄마다 길이가 달라도 같은 열(맨 오른쪽)에 붙도록 모자란 칸은 빈 글자로 채운다
  const rows: (string | number | boolean | Date | null)[][] = table.rows.map((r) => {
    const copy = [...r] as (string | number | boolean | Date | null)[];
    while (copy.length < width) copy.push("");
    return copy;
  });
  rows.forEach((r) => r.push("", "", ""));
  rows[input.headerRowIndex][width] = RESULT_COLUMNS.usage;
  rows[input.headerRowIndex][width + 1] = RESULT_COLUMNS.result;
  rows[input.headerRowIndex][width + 2] = RESULT_COLUMNS.reason;
  input.verdicts.forEach((v, i) => {
    rows[v.leaseRowIndex][width] = clipCell(input.surveyUsage[i] ?? "");
    rows[v.leaseRowIndex][width + 1] = v.result;
    rows[v.leaseRowIndex][width + 2] = v.reason;
  });
  const sheet = XLSX.utils.aoa_to_sheet(rows, { cellDates: true });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, table.sheetName ?? "점검결과");
  return workbook;
}

// ─────────────────────────────────────────────────────────────
// 대응표 엑셀 (계획 작업 20): 이번 점검에서 쓴 "이용현황 문장 → 분류"
// ─────────────────────────────────────────────────────────────

/** 대응표 파일 이름 */
export const MAPPING_FILE_NAME = "대응표.xlsx";

/**
 * 대응표 엑셀의 내용(바이트)을 만든다. 열은 이용현황 | 분류 2개, 한 줄에 문장 하나.
 * 문장은 이름·번호를 가린 문장이고, 분류는 대응표 또는 AI가 정한 값(판단 불가 포함)이다.
 * 다시 올리면 같은 문장에 같은 분류를 쓰고, 분류를 직접 고쳐 올리면 고친 값이 쓰인다.
 */
export function buildMappingWorkbook(sentences: readonly string[], categories: readonly (string | null)[]): Uint8Array {
  const rows: string[][] = [[MAPPING_COLUMNS.usage, MAPPING_COLUMNS.category]];
  sentences.forEach((sentence, id) => {
    const category = categories[id];
    if (category) rows.push([sentence, category]);
  });
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "대응표");
  return new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}
