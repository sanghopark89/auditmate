// 계획 작업 4 / 설계 §2.2 ① — 엑셀·CSV·TXT 파일을 읽어 표(행·열)로 바꾸기
//
// - 엑셀(.xlsx, .xls): 첫 번째 시트만 읽는다. 엑셀 날짜 칸은 Date로 읽는다.
// - CSV(.csv)·텍스트(.txt): 칸을 나누는 기호(탭·쉼표·세미콜론·세로줄)와
//   한글 인코딩(UTF-8·EUC-KR 등)을 알아서 알아본다.
// 이 파일은 "파일 → 표"까지만 맡는다. 제목 줄 찾기·보고서 판별은 detect.ts(작업 5·6)가 맡는다.
// 브라우저(작업자)와 Node 양쪽에서 같은 코드로 돈다. 파일 원본은 서버로 보내지 않는다(설계 §1.1).

import Papa from "papaparse";
import * as XLSX from "xlsx";
import { detectFileKind } from "./file-kinds";
import type { FileKind } from "./file-kinds";

// 파일 종류·큰 파일 기준은 가벼운 file-kinds.ts로 옮겼다(화면에서도 쓰려고). 기존 코드가 그대로 쓰도록 다시 내보낸다
export { LARGE_FILE_WARN_BYTES, detectFileKind, isLargeFile } from "./file-kinds";
export type { FileKind } from "./file-kinds";

// ─────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────

/** 표의 칸 값: 글자, 숫자, 참/거짓, 엑셀 날짜 칸(Date). 빈 칸은 빈 글자("") */
export type CellValue = string | number | boolean | Date;

/** CSV·TXT에서 알아본 글자 인코딩 */
export type TextEncodingName =
  | "utf-8"
  | "utf-8-bom"
  | "utf-16le"
  | "utf-16be"
  | "euc-kr";

/** 파일을 읽은 결과 */
export interface TableData {
  fileName: string;
  kind: FileKind;
  /** 행 목록. 각 행은 칸 값 목록. 엑셀은 첫 번째 시트의 모든 행 */
  rows: CellValue[][];
  /**
   * rows[0][0]이 시트에서 몇 번째 행·열인지 (0부터).
   * CSV·TXT는 항상 {0, 0}. 엑셀 시트의 첫 사용 칸이 A1이 아니면 달라진다.
   * 결과 엑셀에 열을 덧붙일 때 이 값을 더해 원본의 같은 행을 찾는다(설계 §2.2 ⑪).
   */
  origin: { row: number; col: number };
  /** 엑셀일 때: 읽은 시트 이름 (첫 번째 시트) */
  sheetName?: string;
  /** CSV·TXT일 때: 알아본 인코딩 */
  encoding?: TextEncodingName;
  /** CSV·TXT일 때: 알아본 칸 나눔 기호 ("," · "\t" · ";" · "|") */
  delimiter?: string;
  /**
   * 엑셀일 때: 원본 시트 (keepSheet 옵션을 켰을 때만).
   * 결과 엑셀을 만들 때 원본에 두 열을 덧붙이려고 보관한다(설계 §2.2 ⑪).
   * 메모리를 줄이려고 "dense" 방식으로 읽는다. 칸은 sheet["!data"][행][열]에 있다.
   */
  sheet?: XLSX.WorkSheet;
}

export interface ReadTableOptions {
  /** 엑셀 원본 시트를 결과에 함께 담을지 (대부계약 현황에만 켠다). 기본 꺼짐 */
  keepSheet?: boolean;
}

export type ReadFileErrorCode =
  | "unsupported-type"
  | "empty-file"
  | "unreadable"
  | "no-sheet";

/** 파일을 읽을 수 없을 때 던지는 오류. message는 화면에 그대로 보여줄 한국어 안내다 (설계 §6.1) */
export class ReadFileError extends Error {
  code: ReadFileErrorCode;

  constructor(code: ReadFileErrorCode, message: string) {
    super(message);
    this.name = "ReadFileError";
    this.code = code;
  }
}

// ─────────────────────────────────────────────────────────────
// 진짜 엑셀 파일인지 확인
// ─────────────────────────────────────────────────────────────

// 진짜 엑셀 파일인지 첫 몇 글자로 확인한다: .xlsx는 ZIP("PK"), .xls는 OLE 문서
function isZip(b: Uint8Array): boolean {
  return b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b;
}
function isOle(b: Uint8Array): boolean {
  return (
    b.length >= 8 &&
    b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0 &&
    b[4] === 0xa1 && b[5] === 0xb1 && b[6] === 0x1a && b[7] === 0xe1
  );
}

// ─────────────────────────────────────────────────────────────
// 글자 인코딩 알아보기 (CSV·TXT)
// ─────────────────────────────────────────────────────────────

/**
 * 파일의 글자 인코딩을 알아내 글자로 바꾼다.
 * 1) 맨 앞 표시(BOM)가 있으면 그대로 따른다.
 * 2) 없으면 UTF-8로 엄격하게 읽어 보고, 깨지면 EUC-KR(윈도우 한글 확장 포함)로 읽는다.
 *    공공기관 시스템에서 내려받은 파일은 EUC-KR인 경우가 많다.
 *
 * 주의: 브라우저의 TextDecoder("euc-kr")는 윈도우 한글 확장(똠·갂 등 11,172자 전체)을 읽지만,
 * Node의 TextDecoder는 KS X 1001에 없는 글자를 잘못 읽는다(확인함).
 * 그래서 이 함수는 브라우저(작업자)에서 쓴다. Node 쪽 코드(서버·시험)에서 EUC-KR 파일을
 * 읽어야 하면 별도 변환 도구가 필요하다.
 */
export function decodeText(bytes: Uint8Array): {
  encoding: TextEncodingName;
  text: string;
} {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { encoding: "utf-8-bom", text: new TextDecoder("utf-8").decode(bytes.subarray(3)) };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { encoding: "utf-16le", text: new TextDecoder("utf-16le").decode(bytes.subarray(2)) };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { encoding: "utf-16be", text: new TextDecoder("utf-16be").decode(bytes.subarray(2)) };
  }
  try {
    return { encoding: "utf-8", text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    // UTF-8 규칙에 맞지 않는 바이트가 있으면 EUC-KR로 본다
    return { encoding: "euc-kr", text: new TextDecoder("euc-kr").decode(bytes) };
  }
}

// ─────────────────────────────────────────────────────────────
// 칸 나누는 기호 알아보기 (CSV·TXT)
// ─────────────────────────────────────────────────────────────

// 후보 순서가 곧 우선순위다 (점수가 같으면 앞의 것). 탭을 쉼표보다 먼저 본다
const DELIMITER_CANDIDATES = ["\t", ",", ";", "|"] as const;

/** 따옴표 안을 빼고 기호가 몇 번 나오는지 센다 */
function countOutsideQuotes(line: string, delimiter: string): number {
  let inQuotes = false;
  let count = 0;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === delimiter && !inQuotes) count++;
  }
  return count;
}

/**
 * 맨 위 50줄을 보고 칸 나누는 기호를 고른다.
 * 기호마다 "줄마다 나온 횟수"를 세어, 같은 횟수로 나오는 줄이 가장 많은 기호를 고른다.
 * (제목 줄이 있어도, 문장 안에 쉼표가 있어도 줄마다 고르게 나오는 기호가 이긴다.)
 * 어느 기호도 안 나오면(한 칸짜리 파일) 쉼표로 본다.
 */
export function detectDelimiter(text: string): string {
  const lines = text
    .slice(0, 200_000)
    .split(/\r\n|\n|\r/)
    .filter((line) => line.trim() !== "")
    .slice(0, 50);

  let best = ",";
  let bestScore = 0;
  for (const delimiter of DELIMITER_CANDIDATES) {
    // 줄마다 나온 횟수(0은 제외)를 모아, 가장 흔한 횟수의 줄 수를 점수로 삼는다
    const frequency = new Map<number, number>();
    for (const line of lines) {
      const n = countOutsideQuotes(line, delimiter);
      if (n > 0) frequency.set(n, (frequency.get(n) ?? 0) + 1);
    }
    const score = Math.max(0, ...frequency.values());
    if (score > bestScore) {
      best = delimiter;
      bestScore = score;
    }
  }
  return best;
}

// ─────────────────────────────────────────────────────────────
// 읽기
// ─────────────────────────────────────────────────────────────

function isEmptyRow(row: CellValue[]): boolean {
  return row.every((cell) => cell === "");
}

function readDelimited(
  bytes: Uint8Array,
): { rows: CellValue[][]; encoding: TextEncodingName; delimiter: string } {
  const { encoding, text } = decodeText(bytes);
  const delimiter = detectDelimiter(text);
  const parsed = Papa.parse<string[]>(text, { delimiter, skipEmptyLines: false });
  const rows: CellValue[][] = parsed.data;
  // 파일 끝의 줄바꿈 때문에 생기는 빈 행은 지운다
  while (rows.length > 0 && isEmptyRow(rows[rows.length - 1])) rows.pop();
  return { rows, encoding, delimiter };
}

function readExcel(
  bytes: Uint8Array,
  options: ReadTableOptions,
): {
  rows: CellValue[][];
  sheetName: string;
  origin: { row: number; col: number };
  sheet?: XLSX.WorkSheet;
} {
  if (!isZip(bytes) && !isOle(bytes)) {
    throw new ReadFileError(
      "unreadable",
      "엑셀 파일을 읽을 수 없습니다. 엑셀에서 열어 .xlsx로 다시 저장한 뒤 올려 주세요",
    );
  }
  let workbook: XLSX.WorkBook;
  try {
    // 날짜 칸은 Date로, 메모리를 아끼도록 dense 방식으로 읽는다
    workbook = XLSX.read(bytes, { type: "array", cellDates: true, dense: true });
  } catch {
    throw new ReadFileError(
      "unreadable",
      "엑셀 파일을 읽을 수 없습니다. 파일이 손상되었거나 암호가 걸려 있을 수 있습니다",
    );
  }
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new ReadFileError("no-sheet", "엑셀 파일에 시트가 없습니다");

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<CellValue[]>(sheet, {
    header: 1, // 제목 줄을 따로 두지 않고 모든 행을 그대로 가져온다
    raw: true, // 숫자·날짜를 글자로 바꾸지 않는다
    defval: "", // 빈 칸은 빈 글자
    blankrows: true,
  });
  // 시트의 첫 사용 칸 위치 (rows[0][0]이 가리키는 칸)
  const ref = sheet["!ref"];
  const start = ref ? XLSX.utils.decode_range(ref).s : { r: 0, c: 0 };
  return {
    rows,
    sheetName,
    origin: { row: start.r, col: start.c },
    sheet: options.keepSheet ? sheet : undefined,
  };
}

/**
 * 파일 내용(바이트)을 표로 읽는다.
 * 읽을 수 없으면 ReadFileError를 던진다 (message를 그대로 화면에 안내하면 된다).
 */
export function readTable(
  data: ArrayBuffer | Uint8Array,
  fileName: string,
  options: ReadTableOptions = {},
): TableData {
  const kind = detectFileKind(fileName);
  if (!kind) {
    throw new ReadFileError("unsupported-type", "엑셀·CSV·TXT 파일만 올릴 수 있습니다");
  }
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length === 0) {
    throw new ReadFileError("empty-file", "비어 있는 파일입니다");
  }

  if (kind === "xlsx" || kind === "xls") {
    const { rows, sheetName, origin, sheet } = readExcel(bytes, options);
    return { fileName, kind, rows, origin, sheetName, ...(sheet ? { sheet } : {}) };
  }
  const { rows, encoding, delimiter } = readDelimited(bytes);
  return { fileName, kind, rows, origin: { row: 0, col: 0 }, encoding, delimiter };
}

/** 브라우저에서 고른 파일(File)을 표로 읽는다 */
export async function readTableFromFile(
  file: File,
  options: ReadTableOptions = {},
): Promise<TableData> {
  return readTable(await file.arrayBuffer(), file.name, options);
}
