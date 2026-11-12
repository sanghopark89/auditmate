// 계획 작업 15 / 설계 §6.1 — 파일 종류 알아보기와 "큰 파일" 경고 기준 (가벼운 파일)
//
// 화면(브라우저 본 줄기)도 파일을 올릴 때 확장자와 크기를 보고 안내해야 한다. 그런데 파일을 읽는 read-file.ts는
// 엑셀·CSV 도구(약 1MB)를 함께 불러와서 화면 쪽 코드가 무거워진다. 그래서 화면에 필요한 부분만 이 파일로 떼어 냈다.
// read-file.ts도 이 파일의 내용을 그대로 다시 내보내므로, 기존 코드는 바뀐 것이 없다.

/** 읽을 수 있는 파일 종류 */
export type FileKind = "xlsx" | "xls" | "csv" | "txt";

const EXTENSION_TO_KIND: Record<string, FileKind> = {
  xlsx: "xlsx",
  xls: "xls",
  csv: "csv",
  txt: "txt",
};

/** 파일 이름 끝(확장자)으로 종류를 알아본다. 모르는 종류면 null */
export function detectFileKind(fileName: string): FileKind | null {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return null;
  return EXTENSION_TO_KIND[fileName.slice(dot + 1).trim().toLowerCase()] ?? null;
}

/**
 * "파일이 커서 처리 중 멈출 수 있습니다" 경고를 띄울 파일 크기 (바이트). 작업 14의 측정으로 정했다 (설계 §2.5).
 *  - 엑셀: 읽는 동안 파일 크기의 수십 배 메모리를 쓴다. 실제 형식 샘플은 행당 약 130바이트로 압축돼 있어
 *    (행 5만 건 = 6.6MB) 60MB는 약 46만 행이고, 읽는 데 약 3GB를 쓸 것으로 본다 (브라우저 한도는 약 4GB).
 *  - CSV·TXT: 글자로 한 번에 읽는다. 96MB(36만 행)가 0.8초·메모리 약 230MB였고, 한 덩어리 글자는
 *    약 5억 자를 넘으면 브라우저가 못 다루므로 300MB부터 경고한다.
 */
export const LARGE_FILE_WARN_BYTES: Record<FileKind, number> = {
  xlsx: 60 * 1024 * 1024,
  xls: 60 * 1024 * 1024,
  csv: 300 * 1024 * 1024,
  txt: 300 * 1024 * 1024,
};

/**
 * 이 크기를 넘으면 올리지 못하게 막는다 (경고와 달리 확인해도 못 올린다). 브라우저 메모리가 바닥나는 것을 막는 안전장치다.
 * 경고 기준(위)의 약 3배: 엑셀 200MB, CSV·TXT 1GB(한 덩어리 글자 한도 약 5억 자 안쪽).
 */
export const MAX_FILE_BYTES: Record<FileKind, number> = {
  xlsx: 200 * 1024 * 1024,
  xls: 200 * 1024 * 1024,
  csv: 1024 * 1024 * 1024,
  txt: 1024 * 1024 * 1024,
};

/** 파일이 올릴 수 있는 최대 크기를 넘는지 */
export function exceedsFileLimit(fileName: string, sizeBytes: number): boolean {
  const kind = detectFileKind(fileName);
  return kind !== null && sizeBytes > MAX_FILE_BYTES[kind];
}

/** 파일이 "매우 큼" 경고 기준을 넘는지. 지원하지 않는 종류는 false (그쪽은 읽을 때 오류로 안내한다) */
export function isLargeFile(fileName: string, sizeBytes: number): boolean {
  const kind = detectFileKind(fileName);
  return kind !== null && sizeBytes > LARGE_FILE_WARN_BYTES[kind];
}
