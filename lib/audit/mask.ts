// 계획 작업 9 / 설계 §2.2 ⑥·§3.5 — 개인정보 가리기와 서로 다른 문장 모으기
//
// AI(외부 서비스)로 보내는 것은 "이용현황 문장"뿐이고, 보내기 전에 여기서 개인정보를 가린다.
//  - 이름: 짝지은 대부계약 행의 고객 이름(피대부자 열)과 글자가 정확히 같은 부분 → "○○○"
//  - 주민등록번호·전화번호: 자릿수·구분 기호 모양으로 찾아서 가린다
// 가린 문장 가운데 서로 다른 것만 모으고, 각각 가설 건축물 낱말이 있는지 규칙으로 검사한다.
//
//  - 제3자 이름(담당 공무원, 토지소유자 등): 이름 뒤에 직함이 붙거나("○○○ 주무관"), 이름 바로 뒤
//    괄호에 전화번호가 오거나("○○○(051-…)"), 앞에 "소유자" 같은 말이 붙은 모양을 찾아 가린다.
//    성이 흔한 성씨이고 3글자(또는 겹성 4글자)인 말만 이름으로 본다 (실제 형식 샘플에서 본 모양 기준).
//
// 한계 (설계 §3.5): 이 모양에 맞지 않는 제3자 이름은 가릴 수 없다 (직함이 없는 이름, 드문 성씨, 2글자 이름 등).
// 이름 일부(이름만, 성만)나 띄어 쓴 이름("홍 길 동")도 가리지 않는다.
// 고객 이름 열이 없으면 고객 이름은 가리지 못하고 제3자 모양과 번호만 가린다.
// 브라우저(작업자)와 Node 양쪽에서 같은 코드로 돈다. 가린 결과만 서버로 보낸다.

import { CUSTOMER_NAME_COLUMNS, findTemporaryStructureWord, tidyText } from "./checkset";
import { cellAt } from "./detect";
import type { TableLayout } from "./detect";
import type { LatestPick, MatchResult } from "./match";
import type { CellValue } from "./read-file";

// ─────────────────────────────────────────────────────────────
// 가리는 글자
// ─────────────────────────────────────────────────────────────

/** 이름을 가린 자리에 쓰는 글자 */
export const NAME_MASK = "○○○";
/** 주민등록번호·전화번호를 가린 자리에 쓰는 글자 */
export const NUMBER_MASK = "○○○○";

/** 이 글자 수보다 짧은 이름은 가리지 않는다 (한 글자 성이 문장 곳곳에서 잘못 가려지는 것을 막기 위해) */
const MIN_NAME_LENGTH = 2;

// 주민등록번호: 앞 6자리(생년월일) + 구분 기호(없어도 됨) + 뒤 7자리(첫 자리 1~8). 앞뒤에 숫자가 더 붙으면 아님
const RESIDENT_NUMBER = /(?<!\d)\d{6}[-\s]?[1-8]\d{6}(?!\d)/g;

// 휴대전화: 010·011·016·017·018·019 + 3~4자리 + 4자리 (구분 기호는 하이픈·점·공백 또는 없음)
const MOBILE_NUMBER = /(?<!\d)01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/g;

// 지역 번호가 있는 전화: 02·031~064·070·080 + 3~4자리 + 4자리. 날짜·번지와 헷갈리지 않도록
// 구분 기호(하이픈·점·공백, 지역 번호는 괄호도 가능)가 반드시 있는 모양만 가린다
const LANDLINE_NUMBER =
  /(?<!\d)(?:\(0(?:2|[3-6]\d|70|80)\)\s?|0(?:2|[3-6]\d|70|80)[-.\s]\s?)\d{3,4}[-.\s]\d{4}(?!\d)/g;

// 국제 표기 전화: +82 10-1234-5678, +82-2-123-4567 (앞의 0은 빠지거나 (0)으로 적는다)
const INTL_NUMBER = /(?<![\d])\+\s?82[-.\s]?(?:\(0\)[-.\s]?)?\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/g;

// 구분 기호 앞뒤에 공백이 낀 휴대전화: 010 - 1234 - 5678
const SPACED_MOBILE_NUMBER = /(?<!\d)01[016789]\s*[-.]\s*\d{3,4}\s*[-.]\s*\d{4}(?!\d)/g;

// 구분 기호 없이 붙여 쓴 지역 번호 전화: 0511234567, 021234567 (10~11자리)
const PLAIN_LANDLINE_NUMBER = /(?<!\d)0(?:2|[3-6]\d)\d{7,8}(?!\d)/g;

// 이메일 주소
const EMAIL_ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

// 사업자등록번호: 123-45-67890
const BUSINESS_NUMBER = /(?<!\d)\d{3}-\d{2}-\d{5}(?!\d)/g;

/** 전각 숫자·기호(０１０ ‐ ＋ （ ） ．)를 보통 글자로 바꾼다. 전각 숫자로 쓴 번호가 가리기를 피하지 못하게 한다 */
function foldFullwidth(text: string): string {
  return text
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[‐‑‒–—−－]/g, "-")
    .replace(/＋/g, "+")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/．/g, ".");
}

// ─────────────────────────────────────────────────────────────
// 제3자 이름 찾기 (대부계약에 없는 사람: 담당 공무원, 토지소유자 등)
// ─────────────────────────────────────────────────────────────

// 흔한 성씨 (이름으로 볼 말의 첫 글자). 드문 성씨는 일부러 뺐다: 일반 낱말이 이름으로 잘못 가려지는 것을 줄이려고
const COMMON_SURNAMES = new Set(
  [..."김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허유남심노하곽성차주우구민나진지엄채원천방공현"],
);
const DOUBLE_SURNAMES = ["남궁", "황보", "제갈", "선우", "독고", "사공", "서문", "동방"];

// 이름 뒤에 붙는 직함·호칭 (뒤에 조사가 한 글자 붙어도 된다: "주무관이", "과장은")
const TITLES = [
  "주무관", "사무관", "서기관", "담당자", "담당", "과장", "팀장", "계장", "소장", "주임", "대리", "국장",
  "부장", "실장", "대표", "이사", "사장", "위원", "의원", "반장", "통장", "이장", "팀원", "기사", "선생", "씨", "님",
];
// 이름 앞에 붙는 말 ("소유자 ○○○", "토지소유자: ○○○")
const ROLE_WORDS = ["소유자", "점유자", "임차인", "사용자", "대표자", "관리자", "신청인", "민원인", "대부자", "작성자", "조사자"];

// 이름처럼 보이지만 일반 낱말인 것 (성씨로 시작하고 3글자라서 걸릴 수 있는 말). 시험하며 늘린다
const NOT_NAMES = new Set([
  "민원인", "소유자", "점유자", "임차인", "사용자", "관리자", "대부자", "신청인", "관계자", "대표자", "공무원",
  "담당자", "주무관", "국유지", "사유지", "공유지", "시유지", "군유지", "도유지", "나대지", "진입로", "주택가",
  "주택지", "전문가", "진출입", "주차장", "공공기", "공사장",
  "전면적", "전체적", // 실제 샘플에서 "점유자 전면적 …"이 이름으로 잘못 가려졌다
]);
// 이 글자로 끝나는 3글자는 기관·장소 이름이라 이름으로 보지 않는다 (건축과, 관리소, 주민센, 우체국 …)
const PLACE_ENDINGS = new Set([..."과팀실청국처센장소점면읍군로길리"]);

/** 이 말이 사람 이름일 가능성이 높은지: 흔한 성씨로 시작하는 3글자(겹성이면 4글자), 한글만, 기관·장소 낱말이 아님 */
function looksLikeName(token: string): boolean {
  if (!/^[가-힣]+$/.test(token) || NOT_NAMES.has(token)) return false;
  const lengthOk =
    token.length === 3 ? COMMON_SURNAMES.has(token[0]) : token.length === 4 && DOUBLE_SURNAMES.includes(token.slice(0, 2));
  return lengthOk && !PLACE_ENDINGS.has(token[token.length - 1]);
}

// 이름 뒤에는 직함 말고도 "소유자"·"점유자" 같은 말이 붙을 수 있다 ("홍길동 소유자"). 긴 말부터 맞춘다
const TITLE_PATTERN = [...TITLES, ...ROLE_WORDS].sort((a, b) => b.length - a.length).join("|");
const JOSA = "[이가은는을를의도와과께에]";
// ① 이름 + (공백) + 직함:  "홍길동 주무관 확인", "홍길동씨가"
const NAME_THEN_TITLE = new RegExp(`(?<![가-힣])([가-힣]{3,4})(\\s?)(?=(?:${TITLE_PATTERN})${JOSA}?(?![가-힣]))`, "g");
// ② 이름 + 괄호 안 전화번호:  "홍길동(051-123-4567)"
const NAME_THEN_PHONE = /(?<![가-힣])([가-힣]{3,4})(?=\(\s?0\d{1,2}[-.\s)]?\s?\d)/g;
// ③ 소유자 같은 말 + 이름:  "토지소유자 홍길동", "소유자: 홍길동"
const ROLE_THEN_NAME = new RegExp(`((?:${ROLE_WORDS.join("|")})\\s?[:：]?\\s?)([가-힣]{3,4})(?![가-힣])`, "g");

/**
 * 문장에서 제3자 이름으로 보이는 말을 찾아 ○○○으로 바꾼다.
 * tokens에는 가린 말을 돌려준다 (시험과 점검용. 화면이나 서버로 보내지 않는다).
 */
export function maskThirdPartyNames(text: string): { text: string; tokens: string[] } {
  const tokens: string[] = [];
  const mask = (token: string) => {
    if (!looksLikeName(token)) return null;
    tokens.push(token);
    return NAME_MASK;
  };
  let out = text.replace(ROLE_THEN_NAME, (all, role: string, token: string) => {
    const masked = mask(token);
    return masked === null ? all : `${role}${masked}`;
  });
  out = out.replace(NAME_THEN_TITLE, (all, token: string, space: string) => {
    const masked = mask(token);
    return masked === null ? all : `${masked}${space}`;
  });
  out = out.replace(NAME_THEN_PHONE, (all, token: string) => mask(token) ?? all);
  return { text: out, tokens };
}

// ─────────────────────────────────────────────────────────────
// 문장 하나 가리기
// ─────────────────────────────────────────────────────────────

/**
 * 문장을 비교·저장하기 좋게 정리한다: 앞뒤 공백을 지우고, 안의 공백·탭·줄바꿈은 한 칸으로 줄인다.
 * (같은 문장이 줄바꿈 하나 때문에 서로 다른 문장으로 세어지지 않게 하고, 대응표의 열쇠로도 쓴다.)
 */
export function normalizeSentence(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim();
}

export interface MaskResult {
  /** 가린 뒤 정리한 문장 */
  text: string;
  /** 대부계약의 고객 이름을 가린 곳이 있는지 */
  namesMasked: boolean;
  /** 제3자 이름(공무원·소유자 등으로 보이는 말)을 가린 곳이 있는지 */
  thirdPartyNamesMasked: boolean;
  /** 주민등록번호·전화번호를 가린 곳이 있는지 */
  numbersMasked: boolean;
}

/**
 * 이용현황 문장에서 개인정보를 가리고 정리한다.
 * names에는 이 문장과 짝지은 대부계약의 고객 이름들을 넣는다. 긴 이름부터 가려서,
 * 한 이름이 다른 이름 안에 들어 있어도 앞부분만 남는 일이 없게 한다.
 */
export function maskSentence(sentence: string, names: readonly string[]): MaskResult {
  let text = foldFullwidth(sentence.normalize("NFC"));
  let namesMasked = false;
  let numbersMasked = false;

  const usable = [...new Set(names.map((n) => n.normalize("NFC").trim()).filter((n) => n.length >= MIN_NAME_LENGTH))];
  usable.sort((a, b) => b.length - a.length);
  for (const name of usable) {
    if (text.includes(name)) {
      text = text.replaceAll(name, NAME_MASK); // 글자 그대로 바꾼다 (이름에 (주) 같은 기호가 있어도 안전)
      namesMasked = true;
    }
  }
  // 제3자 이름은 번호를 가리기 전에 찾는다 ("이름(051-…)" 모양은 번호가 남아 있어야 알아볼 수 있다)
  const third = maskThirdPartyNames(text);
  text = third.text;
  // 국제 표기·이메일을 먼저 가린다 (그 안의 숫자가 다른 패턴에 반쯤만 걸려 남는 일을 막는다)
  for (const pattern of [
    INTL_NUMBER,
    EMAIL_ADDRESS,
    RESIDENT_NUMBER,
    BUSINESS_NUMBER,
    SPACED_MOBILE_NUMBER,
    MOBILE_NUMBER,
    LANDLINE_NUMBER,
    PLAIN_LANDLINE_NUMBER,
  ]) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      pattern.lastIndex = 0;
      text = text.replace(pattern, NUMBER_MASK);
      numbersMasked = true;
    }
  }
  return {
    text: normalizeSentence(text),
    namesMasked,
    thirdPartyNamesMasked: third.tokens.length > 0,
    numbersMasked,
  };
}

/**
 * 화면 목록에 보여줄 이름: 가운데 글자를 가린다. 홍길동 → 홍*동, 홍길 → 홍*, 남궁민수 → 남**수.
 * 한 글자 이름은 전부 가린다. 빈 이름은 빈 글자.
 */
export function maskNameForDisplay(name: string): string {
  const chars = [...name.trim()];
  if (chars.length === 0) return "";
  if (chars.length === 1) return "*";
  if (chars.length === 2) return `${chars[0]}*`;
  return `${chars[0]}${"*".repeat(chars.length - 2)}${chars[chars.length - 1]}`;
}

// ─────────────────────────────────────────────────────────────
// 서로 다른 문장 모으기
// ─────────────────────────────────────────────────────────────

export interface SentenceSet {
  /** 서로 다른 가린 문장 (처음 나온 순서). 번호(위치)가 곧 문장 번호다 */
  sentences: string[];
  /** 고른 실태조사(picks)마다 쓸 문장 번호. 이용현황이 있는 행(ready)이 아니면 -1 */
  sentenceIdByPick: number[];
  /** 문장 번호별로 찾은 가설 건축물 낱말. 없으면 null */
  temporaryWord: (string | null)[];
  /** 대부계약 표에서 고객 이름 열을 찾았는지. 못 찾았으면 이름은 가리지 못한 것이다 */
  customerNameColumnFound: boolean;
  counts: {
    /** 문장을 가릴 대상이 된 행 수 (이용현황이 있는 행) */
    readyRows: number;
    /** 서로 다른 가린 문장 수 */
    distinctSentences: number;
    /** 대부계약 고객 이름을 가린 문장 수 (서로 다른 문장 기준) */
    sentencesWithNameMasked: number;
    /** 제3자 이름(공무원·소유자 등으로 보이는 말)을 가린 문장 수 (서로 다른 문장 기준) */
    sentencesWithThirdPartyNameMasked: number;
    /** 번호를 가린 문장 수 (서로 다른 문장 기준) */
    sentencesWithNumberMasked: number;
    /** 가설 건축물 낱말이 있는 문장 수 (서로 다른 문장 기준) */
    temporarySentences: number;
  };
}

/** 대부계약 표 제목 줄에서 고객 이름 열의 위치. 후보 중 가장 앞의 것. 없으면 -1 */
export function findCustomerNameColumn(layout: TableLayout): number {
  for (const candidate of CUSTOMER_NAME_COLUMNS) {
    const index = layout.columnIndex[tidyText(candidate)];
    if (index !== undefined) return index;
  }
  return -1;
}

function textOf(value: CellValue | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 고른 이용현황(picks)에서 개인정보를 가리고, 가린 문장 중 서로 다른 것만 모은다.
 * 이름은 "같은 대장번호의 모든 대부계약 행의 고객 이름"을 가린다. 같은 대장번호의 계약이 여러 행이면
 * 이용현황 문장 하나를 함께 쓰기 때문에, 한 사람 이름만 가리면 다른 사람 이름이 남을 수 있어서다.
 * picks와 match는 같은 순서·같은 수여야 한다 (selectLatestSurveys의 결과와 그 입력).
 */
export function buildSentenceSet(
  picks: LatestPick[],
  match: MatchResult,
  leaseRows: CellValue[][],
  leaseLayout: TableLayout,
): SentenceSet {
  const nameColumn = findCustomerNameColumn(leaseLayout);

  // 대장번호별 고객 이름 모으기
  const namesByKey = new Map<string, Set<string>>();
  if (nameColumn >= 0) {
    for (const entry of match.entries) {
      if (entry.key === "") continue;
      const name = textOf(cellAt(leaseRows[entry.leaseRowIndex], nameColumn));
      if (name.length < MIN_NAME_LENGTH) continue;
      let set = namesByKey.get(entry.key);
      if (!set) namesByKey.set(entry.key, (set = new Set()));
      set.add(name);
    }
  }

  const sentences: string[] = [];
  const temporaryWord: (string | null)[] = [];
  const idByText = new Map<string, number>();
  const idByKey = new Map<string, number>(); // 같은 대장번호는 같은 문장이라 다시 가리지 않는다
  const sentenceIdByPick: number[] = new Array(picks.length);
  let readyRows = 0;
  let withName = 0;
  let withThirdParty = 0;
  let withNumber = 0;
  let temporary = 0;

  for (let i = 0; i < picks.length; i++) {
    const pick = picks[i];
    if (pick.status !== "ready") {
      sentenceIdByPick[i] = -1;
      continue;
    }
    readyRows++;
    const key = match.entries[i].key;
    const cached = idByKey.get(key);
    if (cached !== undefined) {
      sentenceIdByPick[i] = cached;
      continue;
    }
    const masked = maskSentence(pick.usage, [...(namesByKey.get(key) ?? [])]);
    let id = idByText.get(masked.text);
    if (id === undefined) {
      id = sentences.length;
      sentences.push(masked.text);
      idByText.set(masked.text, id);
      const word = findTemporaryStructureWord(masked.text);
      temporaryWord.push(word);
      if (word) temporary++;
      if (masked.namesMasked) withName++;
      if (masked.thirdPartyNamesMasked) withThirdParty++;
      if (masked.numbersMasked) withNumber++;
    }
    idByKey.set(key, id);
    sentenceIdByPick[i] = id;
  }

  return {
    sentences,
    sentenceIdByPick,
    temporaryWord,
    customerNameColumnFound: nameColumn >= 0,
    counts: {
      readyRows,
      distinctSentences: sentences.length,
      sentencesWithNameMasked: withName,
      sentencesWithThirdPartyNameMasked: withThirdParty,
      sentencesWithNumberMasked: withNumber,
      temporarySentences: temporary,
    },
  };
}
