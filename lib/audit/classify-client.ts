// 계획 작업 10 / 설계 §3.1·§6.1 — 대응표(이용현황 문장 → 분류) 읽기·검사·적용
//
// 대응표는 "이용현황 | 분류" 두 열짜리 엑셀이다. 이전 점검에서 AI가 분류한 결과를 내려받아 두었다가
// 다음 점검 때 다시 올리면, 표에 있는 문장은 AI에게 묻지 않고 표의 분류를 그대로 쓴다.
// 감사역이 표에서 잘못된 분류를 직접 고쳐 올리면 그 분류가 쓰인다.
//
// 이 파일이 하는 일
//  - 작업 10: 대응표 읽기·검사·적용
//  - 작업 12: 대응표에 없는 문장을 100개씩 묶어 서버(/api/classify)로 보내고 결과를 모은다.
//            동시에 8묶음, 502·429·503은 기다렸다 최대 3번 재시도, 500자 넘는 문장은 앞 500자만 보낸다.
// 화면·서버와 무관한 코드라 그대로 시험할 수 있다 (보내는 함수 fetch는 바꿔 끼울 수 있다).

import {
  CLASSIFY_BATCH_SIZE,
  CLASSIFY_CONCURRENCY,
  CLASSIFY_MAX_RETRIES,
  CLASSIFY_MAX_TEXT_LENGTH,
  HEADER_SCAN_ROWS,
  MAPPING_COLUMNS,
  UNDECIDABLE,
  UPLOAD_MESSAGES,
  isAiCategory,
  parseClassification,
  tidyText,
} from "./checkset";
import type { AiCategory } from "./checkset";
import { cellAt } from "./detect";
import { maskSentence } from "./mask";
import type { CellValue } from "./read-file";

// ─────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────

/** 대응표를 읽은 결과 */
export interface MappingParseResult {
  /**
   * 대응표 열쇠(가린 뒤 정리한 이용현황 문장) → 분류.
   * 열쇠는 mask.ts의 가린 문장과 같은 모양이라 buildSentenceSet의 문장으로 바로 찾을 수 있다.
   */
  map: Map<string, AiCategory>;
  /** 열 이름이 맞지 않아 대응표를 아예 쓰지 못함 */
  formatError: boolean;
  /** 올바르지 않아 무시한 줄 번호 (엑셀 화면의 줄 번호, 1부터) */
  ignoredLines: number[];
  /** 같은 문장이 서로 다른 분류로 두 번 이상 있어 마지막 줄을 쓴 문장 수 */
  conflictingSentences: number;
  /** 화면에 안내할 문구 (없으면 빈 목록) */
  notices: string[];
}

// ─────────────────────────────────────────────────────────────
// 대응표 읽기
// ─────────────────────────────────────────────────────────────

const USAGE_KEY = tidyText(MAPPING_COLUMNS.usage);
const CATEGORY_KEY = tidyText(MAPPING_COLUMNS.category);

/** 칸 값을 글자로 본다. 숫자는 글자로, 날짜·참거짓·빈 칸은 빈 글자 */
function textOf(value: CellValue | undefined): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}

/** 입력한 분류 글자를 허용 분류 6가지 중 하나로 바꾼다 (공백 차이는 무시: "판단불가"도 "판단 불가"로). 아니면 null */
function toCategory(text: string): AiCategory | null {
  return parseClassification(text); // 용도를 +·,·/로 이은 값도 받는다 (예: 농업용+주거용)
}

/** 제목 줄에서 이용현황·분류 열의 위치를 찾는다. 맨 위 30줄 안에서 두 열이 모두 있는 첫 줄 */
function findMappingHeader(rows: CellValue[][]): { rowIndex: number; usage: number; category: number } | null {
  const limit = Math.min(HEADER_SCAN_ROWS, rows.length);
  for (let i = 0; i < limit; i++) {
    let usage = -1;
    let category = -1;
    rows[i].forEach((cell, index) => {
      const key = tidyText(textOf(cell));
      if (usage < 0 && key === USAGE_KEY) usage = index;
      if (category < 0 && key === CATEGORY_KEY) category = index;
    });
    if (usage >= 0 && category >= 0) return { rowIndex: i, usage, category };
  }
  return null;
}

/**
 * 대응표 표(read-file의 rows)를 검사해서 읽는다.
 *  - 이용현황·분류 열이 없으면 formatError (대응표를 쓰지 않는다).
 *  - 분류 칸이 허용 6가지(농업용·주거용·상업용·종교용지·기타·판단 불가)가 아니거나, 어느 한 칸이 비어 있으면
 *    그 줄은 무시하고 줄 번호를 안내한다 (그 문장은 AI에게 묻게 된다). 완전히 빈 줄은 조용히 건너뛴다.
 *  - 같은 문장이 두 번 이상이면 마지막 줄을 쓴다. 분류가 서로 다르면 안내한다.
 *  - 문장은 이전 점검의 가린 문장과 같은 모양으로 맞춰 둔다(번호·이름 모양 가리기, 공백 정리).
 *    감사역이 가리기 전의 글을 붙여 넣어도 같은 열쇠가 된다.
 * origin은 표의 첫 칸이 시트의 몇 번째 행·열인지(read-file의 origin)로, 줄 번호를 시트 기준으로 맞추는 데 쓴다.
 */
export function parseMappingTable(
  rows: CellValue[][],
  origin: { row: number; col: number } = { row: 0, col: 0 },
): MappingParseResult {
  const header = findMappingHeader(rows);
  if (!header) {
    return {
      map: new Map(),
      formatError: true,
      ignoredLines: [],
      conflictingSentences: 0,
      notices: [UPLOAD_MESSAGES.mappingFormat],
    };
  }

  const map = new Map<string, AiCategory>();
  const ignoredLines: number[] = [];
  const conflicted = new Set<string>();
  for (let i = header.rowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    const usageText = textOf(cellAt(row, header.usage));
    const categoryText = textOf(cellAt(row, header.category));
    if (usageText === "" && categoryText === "") continue; // 빈 줄

    const category = toCategory(categoryText);
    if (usageText === "" || category === null) {
      ignoredLines.push(origin.row + i + 1); // 엑셀 화면의 줄 번호
      continue;
    }
    const key = maskSentence(usageText, []).text;
    if (key === "") {
      ignoredLines.push(origin.row + i + 1);
      continue;
    }
    const before = map.get(key);
    if (before !== undefined && before !== category) conflicted.add(key);
    map.set(key, category); // 마지막 줄이 이긴다
  }

  const notices: string[] = [];
  if (ignoredLines.length > 0) notices.push(UPLOAD_MESSAGES.mappingIgnored(ignoredLines));
  if (conflicted.size > 0) notices.push(UPLOAD_MESSAGES.mappingDuplicate);
  return { map, formatError: false, ignoredLines, conflictingSentences: conflicted.size, notices };
}

// ─────────────────────────────────────────────────────────────
// 대응표 적용
// ─────────────────────────────────────────────────────────────

export interface MappingApplied {
  /** 문장 번호별 분류. 대응표에 있으면 그 분류, 없으면 null (AI에게 물어야 함) */
  categories: (AiCategory | null)[];
  /** AI에게 물어야 하는 문장 번호 (위에서 아래 순서) */
  pendingIds: number[];
  /** 대응표로 분류가 채워진 문장 수 */
  hits: number;
}

/**
 * 서로 다른 가린 문장(buildSentenceSet의 sentences)에 대응표의 분류를 채운다.
 * 대응표에 있는 문장은 AI에게 묻지 않고, 없는 문장만 pendingIds에 모은다.
 * 대응표의 분류가 "판단 불가"여도 그대로 쓴다 (점검결과는 "검토 필요"가 된다).
 */
export function applyMapping(
  sentences: readonly string[],
  map: ReadonlyMap<string, AiCategory>,
): MappingApplied {
  const categories: (AiCategory | null)[] = new Array(sentences.length);
  const pendingIds: number[] = [];
  let hits = 0;
  for (let id = 0; id < sentences.length; id++) {
    const found = map.get(sentences[id]);
    if (found === undefined) {
      categories[id] = null;
      pendingIds.push(id);
    } else {
      categories[id] = found;
      hits++;
    }
  }
  return { categories, pendingIds, hits };
}

// ─────────────────────────────────────────────────────────────
// AI 분류 요청 보내기 (작업 12, 설계 §2.4·§4.2)
// ─────────────────────────────────────────────────────────────

/** 진행 상황: 분류가 끝난 문장 수와 전체 문장 수 */
export interface ClassifyProgress {
  done: number;
  total: number;
}

/** 다시 시도하기 전에 알려 주는 내용 (화면에 "다시 시도 중"을 보여줄 때 쓴다) */
export interface ClassifyRetryInfo {
  /** 몇 번째 재시도인지 (1부터) */
  attempt: number;
  /** 얼마나 기다렸다 보내는지 (밀리초) */
  delayMs: number;
  /** 이유: 서버 오류 이름(RATE_LIMITED 등), 연결 문제는 NETWORK */
  code: string;
}

export interface ClassifyOptions {
  /** 분류 요청 주소. 기본 "/api/classify" (Node에서 시험할 때는 전체 주소를 넣는다) */
  endpoint?: string;
  /** 요청을 보내는 함수. 기본은 fetch. 시험에서 가짜로 바꿔 끼운다 */
  fetchImpl?: typeof fetch;
  /** 한 번에 보내는 문장 수. 기본 100 */
  batchSize?: number;
  /** 동시에 보내는 묶음 수. 기본 8. 요청 한도(429)에 걸리면 절반씩 줄인다 */
  concurrency?: number;
  /** 502·429·503 등에서 다시 보내는 최대 횟수. 기본 3 */
  maxRetries?: number;
  /** 첫 재시도 전에 기다리는 시간(밀리초). 이후 2배씩 늘린다. 기본 1000 */
  baseDelayMs?: number;
  /** 기다리는 함수. 시험에서 바꿔 끼운다 */
  sleep?: (ms: number) => Promise<void>;
  /** 중간에 멈추고 싶을 때 쓰는 신호 */
  signal?: AbortSignal;
  onProgress?: (progress: ClassifyProgress) => void;
  onRetry?: (info: ClassifyRetryInfo) => void;
}

/** 재시도해도 실패했거나, 다시 보내도 소용없는 오류. message는 화면에 안내할 문구다 (설계 §6.1) */
export class ClassifyFailedError extends Error {
  /** 서버가 알려 준 오류 이름. 연결 문제는 NETWORK, 답을 읽지 못한 경우는 BAD_BODY */
  code: string;
  /** HTTP 상태. 연결이 안 된 경우는 null */
  status: number | null;

  constructor(code: string, status: number | null) {
    // 키 없음·인증 실패는 인터넷 문제가 아니므로 다른 안내를 보여 준다
    super(code === "AI_NOT_CONFIGURED" || code === "AI_AUTH_FAILED" ? UPLOAD_MESSAGES.aiNotConfigured : UPLOAD_MESSAGES.aiFailed);
    this.name = "ClassifyFailedError";
    this.code = code;
    this.status = status;
  }
}

/** 사용자가 점검을 중간에 멈춤 */
export class ClassifyAbortedError extends Error {
  constructor() {
    super("분류를 멈췄습니다");
    this.name = "ClassifyAbortedError";
  }
}

/** 서버로 보낼 글자: 500자를 넘으면 앞 500자만 (글자 쌍(이모지 등)을 반으로 자르지 않는다) */
export function truncateForAi(text: string): string {
  if (text.length <= CLASSIFY_MAX_TEXT_LENGTH) return text;
  let cut = text.slice(0, CLASSIFY_MAX_TEXT_LENGTH);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1); // 쌍의 앞 절반만 남았으면 버린다
  return cut.trim();
}

// AI에게 지시하는 모양의 말 (한국어·영어). 이용현황 문장에는 거의 나오지 않는 표현만 담았다
const INJECTION_PATTERN =
  /(이전|앞(선|의)?|위(의)?|상기|기존)\s*(지시|명령|규칙|프롬프트)|지시\s*(사항)?\s*(을|를)?\s*(무시|따르)|무시\s*(하고|하세요|하라|해)|프롬프트|시스템\s*(메시지|지시|프롬프트)|(이|위)\s*(목록|문장들)\s*(의\s*)?(전부|모두|모든)|모든\s*문장|분류\s*(하라|하세요|해\s*주|해라)|ignore\s+(all|previous|the|above)|disregard|system\s*prompt|instructions?\b|\bassistant\b|\bjailbreak\b/i;

/** AI에게 지시하는 모양의 문장인지 (프롬프트 인젝션 의심) */
export function looksLikeInjection(text: string): boolean {
  return INJECTION_PATTERN.test(text);
}

// 다시 보내 볼 만한 오류: 요청 한도·서버 문제·일시적 장애. 그 밖(400 등)은 다시 보내도 소용없다
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_RETRY_AFTER_MS = 30_000;
/** 요청 하나를 기다리는 최대 시간(밀리초). 서버 한도(60초)보다 조금 길게 잡았고, 넘으면 연결 문제로 보고 다시 보낸다 */
const REQUEST_TIMEOUT_MS = 90_000;
/** 다시 보내도 소용없는 서버 설정 문제 (키 없음·인증 실패): 관리자가 고쳐야 한다 */
const SERVER_SETUP_CODES = new Set(["AI_NOT_CONFIGURED", "AI_AUTH_FAILED"]);

type SendOutcome =
  | { kind: "ok"; results: Map<string, AiCategory> }
  | { kind: "retry"; code: string; status: number | null; retryAfterMs?: number }
  | { kind: "fatal"; code: string; status: number | null };

/** 응답 본문에서 서버가 알려 준 오류 이름을 꺼낸다 (없으면 HTTP+상태) */
async function errorCodeOf(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    const code = (body as { error?: { code?: unknown } })?.error?.code;
    if (typeof code === "string" && code !== "") return code;
  } catch {
    // 본문을 못 읽어도 상태 코드만으로 처리한다
  }
  return `HTTP_${res.status}`;
}

/** 묶음 하나를 한 번 보내 본다. 성공/다시 시도/다시 시도해도 소용없음 중 하나로 돌려준다 */
async function sendOnce(
  fetchFn: typeof fetch,
  endpoint: string,
  items: { id: string; text: string }[],
  signal: AbortSignal,
): Promise<SendOutcome> {
  let res: Response;
  try {
    res = await fetchFn(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sentences: items }),
      // 사용자가 멈춘 경우와 응답이 너무 늦는 경우를 모두 끊는다
      signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    });
  } catch {
    if (signal.aborted) throw new ClassifyAbortedError();
    return { kind: "retry", code: "NETWORK", status: null }; // 인터넷이 끊김 등
  }

  if (res.ok) {
    try {
      const body: unknown = await res.json();
      const list = (body as { results?: unknown })?.results;
      if (!Array.isArray(list)) return { kind: "retry", code: "BAD_BODY", status: res.status };
      const results = new Map<string, AiCategory>();
      for (const item of list as { id?: unknown; category?: unknown }[]) {
        // 허용 밖 분류 값은 받지 않는다 (아래에서 "판단 불가"로 채워진다)
        if (typeof item?.id === "string" && isAiCategory(item.category) && !results.has(item.id)) {
          results.set(item.id, item.category);
        }
      }
      return { kind: "ok", results };
    } catch {
      return { kind: "retry", code: "BAD_BODY", status: res.status };
    }
  }

  const code = await errorCodeOf(res);
  if (SERVER_SETUP_CODES.has(code)) return { kind: "fatal", code, status: res.status };
  if (!RETRYABLE_STATUS.has(res.status)) return { kind: "fatal", code, status: res.status };
  const seconds = Number(res.headers.get("retry-after"));
  const retryAfterMs =
    res.status === 429 && Number.isFinite(seconds) && seconds > 0
      ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS)
      : undefined;
  return { kind: "retry", code, status: res.status, retryAfterMs };
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 대응표에 없는 문장(pendingIds)을 AI로 분류한다. 결과는 "문장 번호 → 분류"로 돌려준다.
 *  - 100문장씩 묶어 동시에 8묶음까지 보낸다. 요청 한도(429)에 걸리면 동시에 보내는 수를 절반으로 줄인다.
 *  - 502·429·503(·500·504)와 연결 문제는 기다렸다가 최대 3번 다시 보낸다 (1초·2초·4초 + 조금의 흔들림,
 *    429에 Retry-After가 있으면 그 시간). 서버가 알려 준 답이 빠진 문장은 "판단 불가"로 채운다.
 *  - 재시도 끝에도 실패하거나(ClassifyFailedError) 다시 보내도 소용없는 오류(400 등)가 나면 나머지 요청도 멈추고 오류를 던진다.
 *    이때는 점검을 처음부터 다시 실행한다. "판단 불가"로 덮지 않는다(인터넷·AI 장애가 거짓 결과가 되지 않게).
 *  - signal로 멈추면 ClassifyAbortedError를 던진다.
 */
export async function classifyPending(
  sentences: readonly string[],
  pendingIds: readonly number[],
  options: ClassifyOptions = {},
): Promise<Map<number, AiCategory>> {
  const endpoint = options.endpoint ?? "/api/classify";
  const fetchFn = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const batchSize = options.batchSize ?? CLASSIFY_BATCH_SIZE;
  const maxRetries = options.maxRetries ?? CLASSIFY_MAX_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const sleep = options.sleep ?? defaultSleep;

  const results = new Map<number, AiCategory>();
  const total = pendingIds.length;
  options.onProgress?.({ done: 0, total });
  if (total === 0) return results;

  // AI에게 지시하는 모양의 문장(프롬프트 인젝션 의심)은 AI에게 보내지 않고 "판단 불가"(→ 검토 필요)로 둔다.
  // 같은 묶음의 다른 문장 분류까지 바뀌는 것을 막는다 (보안 점검 결과 반영)
  const suspect = pendingIds.filter((id) => looksLikeInjection(sentences[id]));
  for (const id of suspect) results.set(id, UNDECIDABLE);
  const toSend = suspect.length > 0 ? pendingIds.filter((id) => !results.has(id)) : pendingIds;

  const batches: number[][] = [];
  for (let i = 0; i < toSend.length; i += batchSize) batches.push(toSend.slice(i, i + batchSize));
  if (batches.length === 0) {
    options.onProgress?.({ done: total, total });
    return results;
  }

  // 하나가 실패하면 나머지 요청도 멈추려고 안쪽 중단 신호를 따로 둔다. 사용자 신호도 여기에 이어 준다
  const inner = new AbortController();
  const onOuterAbort = () => inner.abort();
  if (options.signal?.aborted) throw new ClassifyAbortedError();
  options.signal?.addEventListener("abort", onOuterAbort);

  const state = {
    next: 0,
    done: suspect.length,
    limit: Math.max(1, Math.min(options.concurrency ?? CLASSIFY_CONCURRENCY, batches.length)),
    failure: null as Error | null,
  };

  async function sendWithRetry(ids: readonly number[]): Promise<Map<string, AiCategory>> {
    const items = ids.map((id) => ({ id: String(id), text: truncateForAi(sentences[id]) }));
    for (let attempt = 0; ; attempt++) {
      if (inner.signal.aborted) throw new ClassifyAbortedError();
      const outcome = await sendOnce(fetchFn, endpoint, items, inner.signal);
      if (outcome.kind === "ok") return outcome.results;
      if (outcome.kind === "fatal") throw new ClassifyFailedError(outcome.code, outcome.status);
      if (outcome.status === 429) state.limit = Math.max(1, Math.floor(state.limit / 2)); // 한도에 걸리면 천천히
      if (attempt >= maxRetries) throw new ClassifyFailedError(outcome.code, outcome.status);
      const delayMs =
        outcome.retryAfterMs ?? Math.round(baseDelayMs * 2 ** attempt + Math.random() * baseDelayMs * 0.25);
      options.onRetry?.({ attempt: attempt + 1, delayMs, code: outcome.code });
      await sleep(delayMs);
    }
  }

  async function worker(index: number): Promise<void> {
    while (true) {
      // 줄어든 동시 수보다 번호가 큰 일꾼은 쉰다 (번호 0은 항상 남는다)
      if (state.failure || index >= state.limit) return;
      const batchIndex = state.next++;
      if (batchIndex >= batches.length) return;
      const ids = batches[batchIndex];
      try {
        const answers = await sendWithRetry(ids);
        for (const id of ids) results.set(id, answers.get(String(id)) ?? UNDECIDABLE);
        state.done += ids.length;
        options.onProgress?.({ done: state.done, total });
      } catch (error) {
        state.failure ??= error as Error; // 처음 난 오류만 남긴다 (나머지는 그 때문에 멈춘 것)
        inner.abort();
        return;
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: state.limit }, (_, index) => worker(index)));
  } finally {
    options.signal?.removeEventListener("abort", onOuterAbort);
  }
  // 처음 난 오류를 알린다 (다른 일꾼은 그 때문에 멈춘 것이라 오류로 치지 않는다)
  if (state.failure) throw state.failure;
  if (options.signal?.aborted) throw new ClassifyAbortedError();
  return results;
}
