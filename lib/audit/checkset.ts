// 계획 작업 2 / 설계 §2.3·§3.1·§3.3~§3.5·§4.2 — 점검 세트 정의 파일 (공통 약속)
//
// 보고서 종류, 필수 열 이름, 점검결과, 분류, 바꿔 읽기 표, 가설 건축물 낱말,
// 고객명 열 후보, 처리 한도를 이 한 파일에 모은다.
// 다른 점검 세트(다른 보고서)를 추가할 때도 이 파일을 먼저 늘린다.
// 화면·서버와 무관한 순수 정의만 두고, 브라우저와 서버 양쪽에서 불러다 쓴다.

// ─────────────────────────────────────────────────────────────
// 1. 점검 세트와 보고서 (PRD 5번 필수 열 표)
// ─────────────────────────────────────────────────────────────

/** 보고서 종류: lease = 대부계약 현황, survey = 최근 실태조사 내역 현황 */
export type ReportKind = "lease" | "survey";

/** 지금 쓸 수 있는 점검 세트 (현재 1종, 화면에서는 자동 선택) */
export const CHECKSET_NAME = "대부목적 위반 점검";

/** 화면에 보여줄 보고서 이름 */
export const REPORT_NAMES: Record<ReportKind, string> = {
  lease: "대부계약 현황 통계 보고서",
  survey: "최근 실태조사 내역 현황 통계 보고서",
};

/** 보고서별 필수 열 (PRD 5번). 열 이름은 글자가 정확히 같아야 한다 */
export const REQUIRED_COLUMNS: Record<ReportKind, readonly string[]> = {
  lease: ["대장번호", "대부목적", "상세용도"],
  survey: ["대장번호", "실태조사일자", "이용현황"],
};

/**
 * 보고서를 알아볼 때 쓰는 열 (설계 §3.4).
 * 대장번호는 두 보고서에 모두 있어서 판별에 쓰지 않는다.
 */
export const DISTINGUISHING_COLUMNS: Record<ReportKind, readonly string[]> = {
  lease: ["대부목적", "상세용도"],
  survey: ["실태조사일자", "이용현황"],
};

/** 제목 줄을 찾을 때 보는 열 이름 전체 (두 보고서의 필수 열을 합친 것) */
export const ALL_REQUIRED_COLUMN_NAMES: readonly string[] = [
  ...new Set([...REQUIRED_COLUMNS.lease, ...REQUIRED_COLUMNS.survey]),
];

// ─────────────────────────────────────────────────────────────
// 2. 점검결과와 분류 (PRD 5번, 설계 §3.1)
// ─────────────────────────────────────────────────────────────

/** 결과 엑셀 `점검결과` 칸에 적는 값 4가지 */
export const CHECK_RESULTS = ["정상", "부적정", "검토 필요", "대조 불가"] as const;
export type CheckResult = (typeof CHECK_RESULTS)[number];

/** 대부목적과 이용현황을 나누는 분류 5가지 */
export const USE_CATEGORIES = [
  "농업용",
  "주거용",
  "상업용",
  "종교용지",
  "기타",
] as const;
export type UseCategory = (typeof USE_CATEGORIES)[number];

/**
 * AI가 애매할 때 돌려주는 분류 값.
 * 이 값은 분류 값이고, 이 결과로 나오는 점검결과는 "검토 필요"다 (설계 §3.3).
 */
export const UNDECIDABLE = "판단 불가" as const;

/** AI 또는 대응표에 적을 수 있는 기본 분류 값 6가지 */
export const AI_CATEGORIES = [...USE_CATEGORIES, UNDECIDABLE] as const;

/**
 * 문장 하나의 분류. 기본 6가지 중 하나이거나, 이용현황에 용도가 둘 이상 섞여 있으면
 * 해당하는 용도를 "+"로 이은 값이다 (예: "농업용+주거용", 항상 USE_CATEGORIES 순서).
 * 판정은 대부목적이 이 용도들 중 하나라도 있으면 "정상"으로 본다 (사용자 결정 2026-11-12).
 */
export type AiCategory = (typeof AI_CATEGORIES)[number] | `${UseCategory}+${string}`;

/** 용도 이름들을 중복 없이 USE_CATEGORIES 순서로 "+"로 잇는다. 하나라도 용도 이름이 아니면 null */
export function joinUseCategories(parts: readonly string[]): AiCategory | null {
  const wanted = new Set<string>();
  for (const part of parts) {
    const key = part.normalize("NFC").replace(/\s+/g, "");
    const found = USE_CATEGORIES.find((c) => c === key);
    if (!found) return null;
    wanted.add(found);
  }
  if (wanted.size === 0) return null;
  return USE_CATEGORIES.filter((c) => wanted.has(c)).join("+") as AiCategory;
}

/** 글자를 분류 값으로 읽는다: 기본 6가지(공백 차이 무시), 또는 용도를 + , / 로 이은 값. 아니면 null */
export function parseClassification(text: string): AiCategory | null {
  const key = text.normalize("NFC").replace(/\s+/g, "");
  const single = AI_CATEGORIES.find((c) => c.replace(/\s+/g, "") === key);
  if (single) return single;
  const parts = key.split(/[+,/·、]/).filter((p) => p !== "");
  return parts.length >= 2 ? joinUseCategories(parts) : null;
}

/** 분류 값이 가리키는 용도 목록 ("판단 불가"는 빈 목록) */
export function classificationParts(category: string): UseCategory[] {
  return category.split("+").filter(isUseCategory);
}

export function isUseCategory(value: unknown): value is UseCategory {
  return (USE_CATEGORIES as readonly unknown[]).includes(value);
}

export function isAiCategory(value: unknown): value is AiCategory {
  return typeof value === "string" && parseClassification(value) === value;
}

// ─────────────────────────────────────────────────────────────
// 3. 대부목적 바꿔 읽기 표 (설계 §3.3)
// ─────────────────────────────────────────────────────────────

/**
 * 실제 보고서의 대부목적 칸에는 5가지 이름이 아닌 표현이 대부분이다.
 * (2026-11-12 사용자가 준 실제 형식 샘플 13,955건 기준: 서로 다른 값이 439가지)
 * 그런 표현을 5가지 분류에 맞추는 표다. AI는 쓰지 않는다.
 *
 * - 키는 공백을 뺀 글자다 ("도시가스 배관 매설" → "도시가스배관매설"). 맨 끝 괄호는 떼고 한 번 더 찾는다.
 * - 여기 없는 표현은 점검결과가 "검토 필요"가 되므로, 잘못 판정하는 일은 없다.
 * - 아래 분류는 샘플 파일의 값을 보고 정한 것이다. "기타"로 묶은 값도 사용자가 확인했다(2026-11-12).
 * - 대지·토지·임야·목장용지 같은 애매한 값은 일부러 넣지 않았다 (검토 필요로 남는다).
 */
export const PURPOSE_ALIASES: Readonly<Record<string, UseCategory>> = {
  // ── 농업용 (샘플 2,433건)
  전: "농업용",
  답: "농업용",
  경작용: "농업용",
  경작용지: "농업용",
  경작: "농업용",
  농경지: "농업용",
  과수원: "농업용",

  // ── 주거용 (샘플 8,2xx건)
  주택부지: "주거용",
  주택부지용: "주거용",
  주택용지: "주거용",
  주거용건물: "주거용",
  "주거용-주거용건물": "주거용",
  "주거용-단독주택": "주거용",
  "주거용-아파트": "주거용",
  "주거용-공동주택": "주거용",
  단독주택: "주거용",
  공동주택: "주거용",

  // ── 상업용
  상가부지: "상업용",
  점포상가: "상업용",
  "판매용-근린생활시설": "상업용",

  // ── 기타 (위 네 가지가 아닌 것으로 분명한 값만. 사용자 확인 완료)
  공장용지: "기타",
  공장부지: "기타",
  주차장: "기타",
  주차장용지: "기타",
  주차장부지: "기타",
  창고용지: "기타",
  창고부지: "기타",
  야적장: "기타",
  도로: "기타",
  잡종지: "기타",
  학교용지: "기타",
  공원용지: "기타",
  체육용지: "기타",
  수도용지: "기타",
  묘지: "기타",
  특수용지: "기타",
  도시가스배관매설: "기타",
  도시가스관매설: "기타",
  도시가스배관매립: "기타",
  도시가스관매립: "기타",
  도시가스관매립부지: "기타",
  도시가스관매립용지: "기타",
  가스관매설: "기타",
};

/** 글자를 비교하기 좋게 정리한다: 모든 공백을 지우고, 한글 조합 방식을 통일한다 */
export function tidyText(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, "");
}

/**
 * 대부목적 글자를 5가지 분류 중 하나로 바꿔 읽는다.
 * 5가지 이름과 같으면 그대로, 바꿔 읽기 표에 있으면 표대로, 둘 다 아니면 null.
 * null이면 점검결과는 "검토 필요(대부목적 분류 불가)"가 된다.
 */
export function resolvePurposeCategory(
  rawPurpose: string | null | undefined,
): UseCategory | null {
  if (!rawPurpose) return null;
  const tidy = tidyText(rawPurpose);
  const found = lookupPurpose(tidy);
  if (found) return found;
  // "경작용(전)", "상가부지(해물판매장)"처럼 맨 끝에 괄호 설명이 붙은 값은 괄호를 떼고 한 번 더 찾는다
  const withoutNote = tidy.replace(/[(（][^)）]*[)）]$/, "");
  return withoutNote !== tidy ? lookupPurpose(withoutNote) : null;
}

function lookupPurpose(tidy: string): UseCategory | null {
  if (isUseCategory(tidy)) return tidy;
  return Object.hasOwn(PURPOSE_ALIASES, tidy) ? PURPOSE_ALIASES[tidy] : null;
}

// ─────────────────────────────────────────────────────────────
// 4. 가설 건축물 낱말 (설계 §3.3) — AI가 아니라 규칙이 찾는다
// ─────────────────────────────────────────────────────────────

/**
 * 이용현황 문장에 이 낱말이 있으면 AI 분류와 관계없이 "검토 필요"가 된다.
 * 앞의 네 개는 설계(§3.3)의 낱말이고, 나머지는 실제 형식 샘플(이용현황 50,277건)에서
 * 확인한 다른 표기다 ("콘테이너 박스", "가설건축물(컨테이너)" 등). 낱말은 시험하며 채운다.
 */
export const TEMPORARY_STRUCTURE_WORDS: readonly string[] = [
  "컨테이너",
  "가건물",
  "비닐하우스",
  "농막",
  "콘테이너", // 컨테이너의 다른 표기
  "비닐 하우스", // 띄어 쓴 표기
  "가설건축물",
  "가설 건축물",
];

/**
 * 가설 건축물 낱말이 들어 있어도 가설 건축물이 아닌 붙여 쓴 말.
 * ("상가건물", "주택가건물"에 "가건물"이 들어 있다.) 띄어 쓴 "상가 건물"·"주택가 건물"은
 * 글자를 그대로 찾기 때문에 걸리지 않는다. 시험하다 확인된 말만 넣고 한 줄씩 늘린다.
 */
export const TEMPORARY_STRUCTURE_EXCEPTIONS: readonly string[] = [
  "상가건물",
  "주택가건물",
];

/**
 * 이용현황 문장에 가설 건축물 낱말이 있으면 그 낱말을, 없으면 null을 돌려준다.
 * 공백을 지우지 않고 글자 그대로 찾는다(한글 조합 방식만 통일).
 * 공백을 지우면 "주택가 건물"이 "가건물"로 잘못 잡히기 때문이다 (실제 샘플에서 확인).
 */
export function findTemporaryStructureWord(
  sentence: string | null | undefined,
): string | null {
  if (!sentence) return null;
  let text = sentence.normalize("NFC");
  for (const exception of TEMPORARY_STRUCTURE_EXCEPTIONS) {
    text = text.replaceAll(exception, "");
  }
  return TEMPORARY_STRUCTURE_WORDS.find((word) => text.includes(word)) ?? null;
}

// ─────────────────────────────────────────────────────────────
// 5. 열 이름 후보 (설계 §3.4·§3.5)
// ─────────────────────────────────────────────────────────────

/**
 * 고객명 열 이름 후보 (이름 가리기에만 쓴다).
 * 실제 형식 샘플의 대부계약 현황에서는 "피대부자"가 고객 이름 열이다
 * (샘플에서는 개인정보라 비워져 있었다). 나머지는 추측이라 양식에 맞춰 늘린다.
 */
export const CUSTOMER_NAME_COLUMNS: readonly string[] = [
  "피대부자",
  "고객명",
  "성명",
  "대부자명",
  "대부자",
];

/** 대응표 엑셀의 열 이름 (열 2개: 이용현황 | 분류) */
export const MAPPING_COLUMNS = { usage: "이용현황", category: "분류" } as const;

/** 결과 엑셀에 맨 오른쪽으로 덧붙이는 열 이름 (열 3개, 이 순서: 실태조사 이용현황 → 점검결과 → 판정사유) */
export const RESULT_COLUMNS = { usage: "실태조사 이용현황", result: "점검결과", reason: "판정사유" } as const;

// ─────────────────────────────────────────────────────────────
// 6. 파일 읽기 기본값 (설계 §3.4) — 시험하며 조정한다
// ─────────────────────────────────────────────────────────────

/** 제목 줄을 찾을 때 맨 위에서부터 훑는 줄 수 */
export const HEADER_SCAN_ROWS = 30;

/** 제목 줄로 인정하려면 필수 열 이름이 최소 몇 개 들어 있어야 하는지 */
export const HEADER_MIN_MATCHES = 2;

/** 이 글자가 들어 있는 행은 합계 행으로 보고 건너뛴다 */
export const TOTAL_ROW_WORDS: readonly string[] = ["합계", "소계", "총계"];

/**
 * 합계 글자를 볼 칸의 최대 글자 수(공백 뺀 길이).
 * 이용현황 같은 긴 문장 속에 "소계" 같은 낱말이 들어 있어도 합계 행으로 잘못 보지 않게 한다.
 */
export const TOTAL_CELL_MAX_LENGTH = 10;

/** 각 파일의 데이터 행 최대 건수 (제목 줄과 건너뛰는 행은 세지 않는다) */
export const MAX_ROWS = 1_000_000;

// ─────────────────────────────────────────────────────────────
// 6-2. 파일 올릴 때 화면에 안내하는 문구 (설계 §6.1)
// ─────────────────────────────────────────────────────────────

export const UPLOAD_MESSAGES = {
  /** 어느 보고서도 아님 → 그 파일 칸을 비운다 */
  notReport: "올바른 보고서가 아닙니다",
  /** 두 칸에 같은 종류의 보고서가 올라옴 → 점검 실행 버튼 비활성 */
  sameKind: "두 칸에 같은 종류의 보고서가 올라왔습니다",
  /** 두 파일의 칸이 서로 바뀌어 있어 자동으로 바로잡음 (안내만) */
  swapped: "두 파일의 칸을 바꿔 맞췄습니다",
  /** 필수 열이 빠짐 → 점검 실행 버튼 비활성 */
  missingColumns: (names: readonly string[]) =>
    `다음 열이 없습니다: ${names.join(", ")}`,
  /** 파일 하나가 다른 종류의 칸에 올라와 맞는 칸으로 옮김 (안내만) */
  movedToSlot: (reportName: string) =>
    `${reportName} 파일이어서 해당 칸으로 옮겨 맞췄습니다`,
  /** 대응표에 이용현황·분류 열이 없음 → 대응표를 쓰지 않는다 */
  mappingFormat: "대응표 형식이 맞지 않습니다",
  /** 대응표의 일부 줄이 올바르지 않음 → 그 줄만 쓰지 않고, 해당 문장은 AI에 묻는다. 줄 번호는 앞 10개만 보여준다 */
  mappingIgnored: (lines: readonly number[]) => {
    const shown = lines.slice(0, 10).join(", ");
    const more = lines.length > 10 ? ` 외 ${lines.length - 10}줄` : "";
    return `대응표 ${lines.length}줄이 올바르지 않아 무시했습니다 (줄 번호: ${shown}${more})`;
  },
  /** 대응표에 같은 문장이 서로 다른 분류로 두 번 이상 → 마지막 줄을 쓴다 */
  mappingDuplicate: "대응표에 같은 문장이 중복되어 마지막 줄을 썼습니다",
  /** AI 분류가 재시도 끝에도 실패 → 점검을 중단하고 처음부터 다시 실행한다 */
  aiFailed: "AI 분류에 실패했습니다. 인터넷 연결을 확인하고 다시 실행해 주세요",
  /** AI 서비스 키가 없거나 인증에 실패 → 다시 해도 소용없음. 관리자가 서버 설정을 고쳐야 한다 */
  aiNotConfigured: "AI 서비스 설정에 문제가 있어 분류할 수 없습니다. 관리자에게 알려 주세요",
  /** 파일이 매우 큼 → 확인해야 점검을 시작한다 (메모리가 모자라면 탭이 통째로 멈출 수 있어 미리 알린다) */
  largeFile: "파일이 커서 처리 중 멈출 수 있습니다. 계속하시겠습니까?",
  /** 점검 작업자가 멈춤(대개 메모리 부족) → 파일이 사라지므로 칸을 비우고 다시 올리게 한다 */
  workerCrashed: "점검이 중간에 멈췄습니다. 파일이 너무 크면 CSV로 나누어 올려 주세요. 파일을 처음부터 다시 올려 주세요",
  /** 한 파일의 데이터 행이 100만 건 초과 → 점검 실행 버튼 비활성 */
  tooManyRows: "한 파일에 최대 100만 건까지 점검할 수 있습니다",
  /** 지원하지 않는 파일 형식 → 그 칸을 비운다 */
  offlineGuide:
    "오프라인 방식은 AI(인터넷)를 쓰지 않습니다. 올린 대응표에 있는 이용현황만 분류하고, 대응표에 없는 이용현황은 '판단 불가'로 두어 점검결과가 '검토 필요'가 됩니다.",
  offlineNoMapping:
    "오프라인 방식인데 대응표를 올리지 않았습니다. 대응표가 없으면 모든 이용현황이 '판단 불가'(검토 필요)가 되어 점검이 거의 의미가 없습니다. 그래도 점검할까요?",
  offlineResult: (count: number) =>
    count > 0
      ? `오프라인 방식으로 점검했습니다. 대응표에 없는 이용현황 ${count.toLocaleString("ko-KR")}개 문장은 AI에 묻지 않고 '판단 불가'(검토 필요)로 두었습니다. 내려받은 대응표의 '판단 불가' 줄에 분류를 적어 다시 올리면 그 분류로 점검됩니다.`
      : "오프라인 방식으로 점검했습니다. AI는 쓰지 않았고, 올린 대응표만으로 모든 이용현황이 분류되었습니다.",
  fileTooBig: "파일이 너무 커서 올릴 수 없습니다 (엑셀 200MB, CSV·TXT 1GB까지). 파일을 나누어 점검해 주세요",
  unsupportedType:"엑셀·CSV·TXT 파일만 올릴 수 있습니다",
  /** 고객 이름 열을 찾지 못함 → 확인해야 점검을 시작한다 (주민번호·전화번호는 가린다) */
  noCustomerColumn: "고객명 열을 찾지 못해 이름은 가리지 못합니다. 계속하시겠습니까?",
  /** 화면에 늘 보여주는 파일 크기 안내 (사용자 결정 2026-11-12) */
  sizeGuide: "엑셀(.xlsx)은 한 파일에 약 40~60만 행까지 올릴 수 있어요. 그보다 크면 CSV나 TXT로 올려 주세요(한 파일 최대 100만 건).",
} as const;

// ─────────────────────────────────────────────────────────────
// 7. 결과 글자 수와 AI 분류 처리 한도 (설계 §2.4·§4.2)
// ─────────────────────────────────────────────────────────────

/** 판정사유 최대 글자 수 */
export const REASON_MAX_LENGTH = 50;

/** AI에 한 번에 보내는 문장 수 (서버도 이 수까지만 받는다) */
export const CLASSIFY_BATCH_SIZE = 100;

/** 문장 하나의 최대 글자 수. 넘으면 브라우저가 앞부분만 잘라 보낸다 */
export const CLASSIFY_MAX_TEXT_LENGTH = 500;

/** 동시에 서버로 보내는 묶음 수 (AI 요청 한도에 맞춰 조정) */
export const CLASSIFY_CONCURRENCY = 8;

/** 502·429·503 오류일 때 기다렸다가 다시 보내는 최대 횟수 */
export const CLASSIFY_MAX_RETRIES = 3;
