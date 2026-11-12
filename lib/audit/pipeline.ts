// 계획 작업 14 / 설계 §2.1·§2.2 — 점검 전체 흐름: 파일 살펴보기(inspect) → 점검 실행(run)
//
// 지금까지 만든 기능을 설계 §2.2의 순서대로 이어서 실행한다.
//   ① 파일 읽기 → ② 제목 줄·③ 보고서 판별 → ④⑤ 짝짓기·최근 1건 → ⑥ 가리기 → ⑦ 대응표 → ⑧ AI 분류 → ⑨ 판정
// 화면·Worker와 무관한 순수 코드라 Node에서 그대로 시험할 수 있다. 브라우저에서는 worker.ts가 이 코드를
// 화면과 따로 돌려, 100만 건에서도 화면이 멈추지 않게 한다.
//
// 메모리 절약 (설계 §1.1 "필요한 값만 뽑아 쓴다"):
//  - 파일을 읽은 뒤 판정에 쓰는 열(대장번호·대부목적·상세용도·고객 이름 / 대장번호·실태조사일자·이용현황)만 남기고
//    나머지 열은 버린다. 행 위치는 그대로라 결과 엑셀의 같은 행에 덧붙일 수 있다.
//  - 대부계약 원본 파일의 바이트는 보관만 해 둔다. 결과 엑셀을 만들 때(작업 19) 다시 읽어 두 열을 덧붙인다.

import { MAX_ROWS, UNDECIDABLE, UPLOAD_MESSAGES, tidyText } from "./checkset";
import type { AiCategory, CheckResult, ReportKind } from "./checkset";
import { applyMapping, classifyPending, parseMappingTable } from "./classify-client";
import type { ClassifyOptions, ClassifyProgress, ClassifyRetryInfo } from "./classify-client";
import { checkUploads, detectReport } from "./detect";
import type { ReportDetection, TableLayout, UploadCheck } from "./detect";
import { judgeAll } from "./judge";
import type { Verdict } from "./judge";
import { MAPPING_FILE_NAME, buildMappingWorkbook, buildResultWorkbook, resultFileName } from "./export";
import { buildSentenceSet, findCustomerNameColumn, maskNameForDisplay } from "./mask";
import type { SentenceSet } from "./mask";
import { matchReports, selectLatestSurveys } from "./match";
import type { MatchResult, PickResult } from "./match";
import { readTable } from "./read-file";
import type { CellValue, FileKind } from "./read-file";

// ─────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────

/** 파일을 올리는 칸 */
export type Slot = "lease" | "survey" | "mapping";

/** 파일 하나를 살펴본 결과 (화면에 보여줄 내용) */
export interface InspectSummary {
  slot: Slot;
  fileName: string;
  kind: FileKind;
  /** 데이터 행 수 (제목 줄·필터 표·합계 행 제외). 대응표는 읽은 문장 수 */
  rowCount: number;
  /** 보고서 칸일 때: 알아본 종류 (null이면 올바른 보고서가 아님) */
  report: ReportKind | null;
  /** 보고서 칸일 때: 빠진 필수 열 이름 */
  missingColumns: string[];
  /** 화면에 안내할 문구 (오류·안내). 없으면 빈 목록 */
  notices: string[];
  /** 대부계약 보고서일 때: 고객 이름 열을 찾았는지 (못 찾으면 이름은 가리지 못한다) */
  customerNameColumnFound?: boolean;
  /** 파일을 읽는 데 걸린 시간 (밀리초) */
  readMs: number;
  /** 작업자가 쓰고 있는 메모리 (MB). 브라우저가 알려 줄 때만 있다 (Chrome 계열). 큰 파일 경고 기준을 정하는 데 쓴다 */
  heapMb?: number;
}

/** 두 칸에 올린 파일을 맞춰 본 결과 (화면으로 보낼 수 있는 작은 모양) */
export interface UploadCheckSummary {
  ready: boolean;
  swapped: boolean;
  notices: string[];
  /** 올린 칸 기준 오류. clear가 true면 그 칸을 비운다 */
  slotErrors: UploadCheck["slotErrors"];
  pairError: string | null;
  /** 대부계약·실태조사로 알아본 파일이 올라온 칸 (없으면 null) */
  leaseFromSlot: "lease" | "survey" | null;
  surveyFromSlot: "lease" | "survey" | null;
}

/** 점검 진행 단계 (설계 §5.4 진행 막대의 단계 이름) */
export type RunStage = "match" | "select" | "mask" | "classify" | "judge" | "done";

export interface RunProgress {
  stage: RunStage;
  /** 이 단계에서 끝낸 수. classify 단계에서만 의미 있다 (끝난 문장 수) */
  done: number;
  /** 이 단계의 전체 수. classify 단계에서는 AI로 보낼 문장 수 */
  total: number;
}

export interface RunOptions {
  /**
   * 오프라인 모드: AI(서버)에 한 번도 묻지 않는다. 대응표에 있는 문장만 분류하고,
   * 대응표에 없는 문장은 "판단 불가"로 두어 점검결과가 "검토 필요"가 된다 (인터넷이 없는 업무망에서 쓰는 방식).
   */
  offline?: boolean;
  /** 분류 요청 주소. 기본 "/api/classify" */
  endpoint?: string;
  /** 시험에서 AI 대신 쓰는 분류 함수 (기본은 classifyPending으로 서버에 요청) */
  classifyFn?: typeof classifyPending;
  /** 분류 요청 옵션을 덧붙인다 (시험용: fetch 바꾸기, 기다림 없애기 등) */
  classifyOptions?: Omit<ClassifyOptions, "endpoint" | "onProgress" | "onRetry">;
  onProgress?: (progress: RunProgress) => void;
  onRetry?: (info: ClassifyRetryInfo) => void;
}

/** 점검을 끝낸 요약 (화면의 결과 요약·내려받기 단계에서 쓴다) */
export interface RunSummary {
  leaseRows: number;
  counts: Record<CheckResult, number>;
  ruleCounts: Record<number, number>;
  /** 부적정 건을 실제 이용 분류(이용현황 문장의 분류)별로 센 것 (유형별 집계) */
  violationByCategory: Record<string, number>;
  /** 서로 다른 가린 문장 수 */
  distinctSentences: number;
  /** 대응표로 채운 문장 수 / AI에 보낸 문장 수 */
  mappingHits: number;
  aiSentences: number;
  /** 오프라인 모드로 돌렸는지, 그때 대응표에 없어 "판단 불가"로 둔 문장 수 */
  offline: boolean;
  unclassifiedOffline: number;
  /** 제3자 이름 가림·번호 가림 문장 수 */
  sentencesWithThirdPartyNameMasked: number;
  sentencesWithNumberMasked: number;
  customerNameColumnFound: boolean;
  /** 단계별 걸린 시간 (밀리초) */
  timingsMs: Record<"match" | "select" | "mask" | "classify" | "judge", number>;
  /** 점검이 끝났을 때 작업자가 쓰고 있는 메모리 (MB). 브라우저가 알려 줄 때만 있다 */
  heapMb?: number;
}

/** 결과 목록에서 보여줄 수 있는 점검결과 (정상은 목록에 없다) */
export type ResultFilter = Exclude<CheckResult, "정상">;
export const RESULT_PAGE_SIZE = 100;

/** 결과 목록의 한 줄 (고객명은 가운데 글자를 가렸고, 이용현황은 이름·번호를 가린 문장이다) */
export interface ResultRow {
  ledger: string;
  /** 소재지 (대부계약 현황의 소재지 열. 열이 없거나 비었으면 대장번호) */
  location: string;
  customer: string;
  purpose: string;
  detail: string;
  /** 대부요율 (대부계약 현황의 대부료율(%) 열 값. 없으면 빈 글자) */
  rate: string;
  usage: string;
  result: CheckResult;
  reason: string;
}

export interface ResultPage {
  filter: ResultFilter;
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  rows: ResultRow[];
}

/** 점검을 시작할 수 없거나 중단된 경우. message는 화면에 안내할 문구다 */
export class AuditError extends Error {
  code: "NOT_READY" | "MAPPING_FORMAT";

  constructor(code: "NOT_READY" | "MAPPING_FORMAT", message: string) {
    super(message);
    this.name = "AuditError";
    this.code = code;
  }
}

// ─────────────────────────────────────────────────────────────
// 필요한 열만 남기기
// ─────────────────────────────────────────────────────────────

const NO_CELLS: CellValue[] = [];

/**
 * 표에서 판정에 쓰는 열만 남긴 얇은 표를 만든다. 행 위치(번호)는 그대로 두고, 데이터 행이 아닌 행은 빈 행으로 둔다.
 * 원래 표(rows)는 이 함수를 부른 쪽에서 버리면 메모리가 크게 줄어든다.
 */
export function slimTable(
  rows: CellValue[][],
  layout: TableLayout,
  keepKeys: readonly string[],
): { rows: CellValue[][]; layout: TableLayout } {
  const kept: { key: string; from: number }[] = [];
  for (const key of keepKeys) {
    const from = layout.columnIndex[key];
    if (from !== undefined && !kept.some((k) => k.key === key)) kept.push({ key, from });
  }
  const slimRows: CellValue[][] = new Array(rows.length).fill(NO_CELLS);
  for (const rowIndex of layout.dataRowIndexes) {
    const row = rows[rowIndex];
    const slim: CellValue[] = new Array(kept.length);
    for (let c = 0; c < kept.length; c++) slim[c] = row[kept[c].from] ?? "";
    slimRows[rowIndex] = slim;
  }
  const columnIndex: Record<string, number> = {};
  kept.forEach((k, c) => (columnIndex[k.key] = c));
  const headers = kept.map((k) => layout.headers[k.from] ?? "");
  // 제목 줄 위치와 데이터 행 위치는 그대로, 제목 줄 행은 얇은 표에서 비어 있어도 된다
  return { rows: slimRows, layout: { ...layout, headers, columnIndex } };
}

// ─────────────────────────────────────────────────────────────
// 점검 세션: 파일을 올릴 때마다 살펴보고, 실행하면 끝까지 돌린다
// ─────────────────────────────────────────────────────────────

interface LoadedReport {
  detection: ReportDetection;
  /** 얇게 줄인 표 (보고서 종류를 알아봤을 때만) */
  rows: CellValue[][] | null;
  layout: TableLayout | null;
}

const KEEP_KEYS: Record<ReportKind, readonly string[]> = {
  lease: [tidyText("대장번호"), tidyText("대부목적"), tidyText("상세용도")],
  survey: [tidyText("대장번호"), tidyText("실태조사일자"), tidyText("이용현황")],
};

// 결과 목록에 보여줄 선택 열 (없어도 점검은 된다). 소재지는 대장번호 대신, 대부요율은 상세용도 오른쪽에 보여 준다
const LOCATION_COLUMNS = ["소재지"];
const RATE_COLUMNS = ["대부료율(%)", "대부요율(%)", "대부료율", "대부요율"];

/** 제목 줄에서 후보 이름 중 가장 앞의 열 위치. 없으면 -1 */
function findColumn(layout: { columnIndex: Record<string, number> }, candidates: readonly string[]): number {
  for (const name of candidates) {
    const index = layout.columnIndex[tidyText(name)];
    if (index !== undefined) return index;
  }
  return -1;
}

export class AuditSession {
  private reports: { lease: LoadedReport | null; survey: LoadedReport | null } = { lease: null, survey: null };
  private mapping: { map: Map<string, AiCategory>; formatError: boolean; notices: string[] } | null = null;
  /**
   * 칸마다 올린 파일의 원본 바이트 (결과 엑셀을 만들 때 대부계약 파일을 다시 읽는다). 대부계약으로 알아본 파일만 보관한다.
   * 칸별로 따로 보관하므로, 다른 칸을 바꿔 올려도 대부계약 파일의 원본이 사라지지 않는다.
   * 실태조사·대응표 파일의 바이트는 보관하지 않는다.
   */
  private sources: Record<"lease" | "survey", { name: string; bytes: Uint8Array } | null> = { lease: null, survey: null };
  /** 점검을 실행할 때 쓴 대부계약 원본 (결과 엑셀은 반드시 이 파일로 만든다) */
  private resultSource: { name: string; bytes: Uint8Array } | null = null;

  // 점검을 끝낸 뒤 보관하는 결과 (목록·내려받기에서 쓴다)
  verdicts: Verdict[] | null = null;
  sentences: SentenceSet | null = null;
  categories: (AiCategory | null)[] | null = null;
  match: MatchResult | null = null;
  picks: PickResult | null = null;
  /** 결과 목록을 만들 때 쓰는 대부계약 표(얇은 표)와 필터별 행 번호 캐시 */
  private resultLease: { rows: CellValue[][]; layout: TableLayout } | null = null;
  private filtered = new Map<string, number[]>();

  /** 대부계약으로 알아본 원본 파일 (결과 엑셀 만들기용). 없으면 null */
  getLeaseSource(): { name: string; bytes: Uint8Array } | null {
    // 칸이 바뀌어 올라왔어도 "대부계약으로 알아본" 파일의 원본을 돌려준다
    const detection = this.check().assigned.lease;
    if (detection === null) return null;
    const slot = this.reports.lease?.detection === detection ? "lease" : this.reports.survey?.detection === detection ? "survey" : null;
    const source = slot ? this.sources[slot] : null;
    return source ? { name: source.name, bytes: source.bytes } : null;
  }

  /** 올린 파일 하나를 읽어 살펴본다. 파일 내용은 보관하지 않고 필요한 열만 남긴다 */
  inspect(slot: Slot, fileName: string, bytes: Uint8Array): InspectSummary {
    const t0 = performance.now();
    const table = readTable(bytes, fileName);
    const readMs = Math.round(performance.now() - t0);

    if (slot === "mapping") {
      const parsed = parseMappingTable(table.rows, table.origin);
      this.mapping = { map: parsed.map, formatError: parsed.formatError, notices: parsed.notices };
      return {
        slot, fileName, kind: table.kind, rowCount: parsed.map.size, report: null, missingColumns: [],
        notices: parsed.notices, readMs,
      };
    }

    const detection = detectReport(table.rows);
    let loaded: LoadedReport = { detection, rows: null, layout: null };
    let customerNameColumnFound: boolean | undefined;
    if (detection.kind && detection.layout) {
      const keys = [...KEEP_KEYS[detection.kind]];
      if (detection.kind === "lease") {
        // 고객 이름 열은 가리기에 쓰므로 함께 남긴다 (열이 없으면 이름은 가리지 못한다)
        const nameColumn = findCustomerNameColumn(detection.layout);
        customerNameColumnFound = nameColumn >= 0;
        if (nameColumn >= 0) keys.push(tidyText(detection.layout.headers[nameColumn]));
        // 결과 목록에 보여줄 소재지·대부요율 열도 함께 남긴다 (있을 때만)
        for (const candidates of [LOCATION_COLUMNS, RATE_COLUMNS]) {
          const c = findColumn(detection.layout, candidates);
          if (c >= 0) keys.push(tidyText(detection.layout.headers[c]));
        }
      }
      const slim = slimTable(table.rows, detection.layout, keys);
      loaded = { detection: { ...detection, layout: slim.layout }, rows: slim.rows, layout: slim.layout };
    }
    // 올린 칸 기준으로 보관한다 (칸이 바뀌었는지는 check()가 알아본다)
    this.reports[slot] = loaded;
    // 대부계약으로 알아본 파일만 원본 바이트를 보관한다 (같은 칸에 다른 파일을 올리면 이전 보관분은 바뀐다)
    this.sources[slot] = detection.kind === "lease" ? { name: fileName, bytes } : null;
    this.resetResults();

    return {
      slot, fileName, kind: table.kind,
      rowCount: detection.layout?.dataRowIndexes.length ?? 0,
      report: detection.kind,
      missingColumns: detection.missingColumns,
      notices: detection.message ? [detection.message] : [],
      customerNameColumnFound,
      readMs,
    };
  }

  /** 이전 점검 결과를 모두 버린다 (파일이 바뀌면 이전 결과는 맞지 않는다) */
  private resetResults(): void {
    this.verdicts = null;
    this.sentences = null;
    this.categories = null;
    this.match = null;
    this.picks = null;
    this.resultLease = null;
    this.resultSource = null;
    this.filtered.clear();
  }

  /** 올렸던 파일을 칸에서 치운다 (칸을 비우거나 잘못 올려 비울 때). 이전 점검 결과도 함께 버린다 */
  clear(slot: Slot): void {
    if (slot === "mapping") this.mapping = null;
    else this.reports[slot] = null;
    if (slot !== "mapping") this.sources[slot] = null;
    this.resetResults();
  }

  /** 지금 올라와 있는 두 보고서를 맞춰 본다 (칸이 바뀜·같은 종류·열 빠짐 등) */
  check(): UploadCheck {
    const base = checkUploads(this.reports.lease?.detection ?? null, this.reports.survey?.detection ?? null);
    // 데이터 행이 100만 건을 넘는 칸은 오류로 알리고 점검 실행을 막는다 (설계 §6.1)
    const tooMany = (slot: "lease" | "survey") =>
      (this.reports[slot]?.detection.layout?.dataRowIndexes.length ?? 0) > MAX_ROWS;
    const leaseError = tooMany("lease") ? { message: UPLOAD_MESSAGES.tooManyRows, clear: false } : null;
    const surveyError = tooMany("survey") ? { message: UPLOAD_MESSAGES.tooManyRows, clear: false } : null;
    if (!leaseError && !surveyError) return base;
    return {
      ...base,
      ready: false,
      slotErrors: {
        leaseSlot: base.slotErrors.leaseSlot ?? leaseError,
        surveySlot: base.slotErrors.surveySlot ?? surveyError,
      },
    };
  }

  /**
   * check()의 결과를 화면으로 보낼 수 있는 작은 모양으로 줄인다.
   * (check()의 원본은 제목 줄·데이터 행 위치 목록이 들어 있어 Worker 밖으로 보내기엔 너무 크다)
   */
  checkSummary(): UploadCheckSummary {
    const check = this.check();
    const slotOf = (detection: ReportDetection | null): "lease" | "survey" | null => {
      if (detection === null) return null;
      if (this.reports.lease?.detection === detection) return "lease";
      if (this.reports.survey?.detection === detection) return "survey";
      return null;
    };
    return {
      ready: check.ready,
      swapped: check.swapped,
      notices: check.notices,
      slotErrors: check.slotErrors,
      pairError: check.pairError,
      leaseFromSlot: slotOf(check.assigned.lease),
      surveyFromSlot: slotOf(check.assigned.survey),
    };
  }

  /** 점검을 끝까지 돌린다. 두 보고서가 알아봐지고 오류가 없어야 한다 */
  async run(options: RunOptions = {}): Promise<RunSummary> {
    const check = this.check();
    if (!check.ready) throw new AuditError("NOT_READY", "두 보고서가 올바르게 올라와야 점검을 실행할 수 있습니다");
    // 칸이 바뀌어 올라왔어도 알아본 종류대로 쓴다 (check()가 같은 객체를 돌려주므로 객체로 찾는다)
    const loadedBy = (detection: ReportDetection | null) =>
      [this.reports.lease, this.reports.survey].find((r) => r !== null && r.detection === detection) ?? null;
    const leaseReport = loadedBy(check.assigned.lease);
    const surveyReport = loadedBy(check.assigned.survey);
    const leaseSource = this.getLeaseSource();
    // 형식이 맞지 않는 대응표는 쓰지 않고 안내만 한다 (점검은 그대로 진행한다)
    if (!leaseReport?.rows || !leaseReport.layout || !surveyReport?.rows || !surveyReport.layout) {
      throw new AuditError("NOT_READY", "보고서를 읽지 못했습니다. 파일을 다시 올려 주세요");
    }
    const progress = (stage: RunStage, done = 0, total = 0) => options.onProgress?.({ stage, done, total });
    const timingsMs = { match: 0, select: 0, mask: 0, classify: 0, judge: 0 };
    const time = <T>(name: keyof typeof timingsMs, fn: () => T): T => {
      const t0 = performance.now();
      const result = fn();
      timingsMs[name] = Math.round(performance.now() - t0);
      return result;
    };

    progress("match");
    const match = time("match", () => matchReports(leaseReport.rows!, leaseReport.layout!, surveyReport.rows!, surveyReport.layout!));
    progress("select");
    const picks = time("select", () => selectLatestSurveys(match, surveyReport.rows!, surveyReport.layout!));
    progress("mask");
    const sentences = time("mask", () => buildSentenceSet(picks.picks, match, leaseReport.rows!, leaseReport.layout!));

    // 대응표로 채우고 남은 문장만 AI로 보낸다
    const mappingMap = this.mapping && !this.mapping.formatError ? this.mapping.map : new Map<string, AiCategory>();
    const applied = applyMapping(sentences.sentences, mappingMap);
    const categories: (AiCategory | null)[] = [...applied.categories];
    const t0 = performance.now();
    progress("classify", 0, applied.pendingIds.length);
    if (options.offline) {
      // AI 없이: 대응표에 없는 문장은 판단 불가(→ 검토 필요)로 둔다. 감사역이 대응표에 분류를 적어 다시 올리면 그 분류가 쓰인다
      for (const id of applied.pendingIds) categories[id] = UNDECIDABLE;
      progress("classify", applied.pendingIds.length, applied.pendingIds.length);
    } else if (applied.pendingIds.length > 0) {
      const classify = options.classifyFn ?? classifyPending;
      const answers = await classify(sentences.sentences, applied.pendingIds, {
        ...options.classifyOptions,
        endpoint: options.endpoint,
        onProgress: (p: ClassifyProgress) => progress("classify", p.done, p.total),
        onRetry: options.onRetry,
      });
      for (const [id, category] of answers) categories[id] = category;
    }
    timingsMs.classify = Math.round(performance.now() - t0);

    progress("judge");
    const judged = time("judge", () =>
      judgeAll({
        leaseRows: leaseReport.rows!, leaseLayout: leaseReport.layout!, match, picks: picks.picks, sentences, categories,
      }),
    );

    this.match = match;
    this.resultLease = { rows: leaseReport.rows, layout: leaseReport.layout };
    this.resultSource = leaseSource;
    this.filtered.clear();
    this.picks = picks;
    this.sentences = sentences;
    this.categories = categories;
    this.verdicts = judged.verdicts;
    // 부적정 건의 실제 이용 분류별 건수 (판정표 규칙 7)
    const violationByCategory: Record<string, number> = {};
    judged.verdicts.forEach((v, i) => {
      if (v.rule !== 7) return;
      const id = sentences.sentenceIdByPick[i];
      const category = id >= 0 ? categories[id] : null;
      if (category) violationByCategory[category] = (violationByCategory[category] ?? 0) + 1;
    });

    progress("done");

    return {
      leaseRows: judged.verdicts.length,
      counts: judged.counts,
      ruleCounts: judged.ruleCounts,
      violationByCategory,
      distinctSentences: sentences.sentences.length,
      mappingHits: applied.hits,
      aiSentences: options.offline ? 0 : applied.pendingIds.length,
      offline: !!options.offline,
      unclassifiedOffline: options.offline ? applied.pendingIds.length : 0,
      sentencesWithThirdPartyNameMasked: sentences.counts.sentencesWithThirdPartyNameMasked,
      sentencesWithNumberMasked: sentences.counts.sentencesWithNumberMasked,
      customerNameColumnFound: sentences.customerNameColumnFound,
      timingsMs,
    };
  }

  /**
   * 결과 목록의 한 쪽을 만든다 (점검을 끝낸 뒤에만). 고객명은 가운데 글자를 가리고,
   * 이용현황은 이름·번호를 가린 문장(AI에 보낸 것과 같은 문장)만 보여준다.
   */
  listResults(filter: ResultFilter, page: number, pageSize = RESULT_PAGE_SIZE): ResultPage {
    const { verdicts, picks, sentences, resultLease } = this;
    if (!verdicts || !picks || !sentences || !resultLease) throw new AuditError("NOT_READY", "점검 결과가 없습니다. 점검을 먼저 실행해 주세요");
    let indexes = this.filtered.get(filter);
    if (!indexes) {
      indexes = [];
      verdicts.forEach((v, i) => {
        if (v.result === filter) indexes!.push(i);
      });
      this.filtered.set(filter, indexes);
    }
    const pageCount = Math.max(1, Math.ceil(indexes.length / pageSize));
    const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
    const { rows, layout } = resultLease;
    const col = (name: string) => layout.columnIndex[tidyText(name)] ?? -1;
    const ledgerCol = col("대장번호");
    const purposeCol = col("대부목적");
    const detailCol = col("상세용도");
    const nameCol = findCustomerNameColumn(layout);
    const locationCol = findColumn(layout, LOCATION_COLUMNS);
    const rateCol = findColumn(layout, RATE_COLUMNS);
    const text = (row: CellValue[], c: number): string => {
      const v = c >= 0 ? row[c] : undefined;
      return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
    };
    const out: ResultRow[] = [];
    for (const i of indexes.slice((current - 1) * pageSize, current * pageSize)) {
      const row = rows[verdicts[i].leaseRowIndex] ?? [];
      const sentenceId = sentences.sentenceIdByPick[i];
      out.push({
        ledger: text(row, ledgerCol),
        location: text(row, locationCol) || text(row, ledgerCol),
        customer: maskNameForDisplay(text(row, nameCol)),
        purpose: text(row, purposeCol),
        detail: text(row, detailCol),
        rate: text(row, rateCol),
        usage: sentenceId >= 0 ? sentences.sentences[sentenceId] : "",
        result: verdicts[i].result,
        reason: verdicts[i].reason,
      });
    }
    return { filter, total: indexes.length, page: current, pageCount, pageSize, rows: out };
  }

  /** 결과 엑셀을 만든다 (점검을 끝낸 뒤에만). 원본 대부계약 파일을 다시 읽어 점검결과·판정사유 열을 덧붙인다 */
  exportResult(): { fileName: string; bytes: Uint8Array } {
    const source = this.resultSource;
    if (!this.verdicts || !this.picks || !this.resultLease || !source) {
      throw new AuditError("NOT_READY", "점검 결과가 없습니다. 점검을 먼저 실행해 주세요");
    }
    const bytes = buildResultWorkbook({
      source,
      headerRowIndex: this.resultLease.layout.headerRowIndex,
      verdicts: this.verdicts,
      // 열 순서: 실태조사 이용현황, 점검결과, 판정사유. 이용현황은 점검에 쓴(고른) 실태조사 행의 원문이다
      surveyUsage: this.picks.picks.map((p) => p.usage),
    });
    return { fileName: resultFileName(source.name), bytes };
  }

  /** 대응표 엑셀을 만든다 (점검을 끝낸 뒤에만). 이번 점검에서 쓴 문장과 분류를 담는다 */
  exportMapping(): { fileName: string; bytes: Uint8Array } {
    if (!this.sentences || !this.categories) throw new AuditError("NOT_READY", "점검 결과가 없습니다. 점검을 먼저 실행해 주세요");
    return { fileName: MAPPING_FILE_NAME, bytes: buildMappingWorkbook(this.sentences.sentences, this.categories) };
  }

  /** 대응표를 올렸을 때의 안내 문구 (형식 오류·무시한 줄 등) */
  mappingNotices(): string[] {
    return this.mapping?.notices ?? [];
  }
}

// 대응표 형식 오류 안내 문구를 화면 쪽에서도 같은 것으로 쓰도록 다시 내보낸다
export const MAPPING_FORMAT_MESSAGE = UPLOAD_MESSAGES.mappingFormat;
