"use client";

// 계획 작업 15 / 설계 §5.1·§5.2 — 점검 화면: 파일 올리기 + 점검 실행
// 파일은 브라우저 안의 점검 작업자(Web Worker)로만 넘어가고, 서버로는 가린 문장만 간다.
// 진행률(작업 16)·결과 요약과 목록(작업 18·22)·내려받기(작업 19~20)를 모두 이 화면에서 보여준다.

import { useCallback, useEffect, useRef, useState } from "react";
import { REPORT_NAMES, UPLOAD_MESSAGES } from "@/lib/audit/checkset";
import type { CheckSetInfo } from "@/lib/audit/checksets";
import { detectFileKind, exceedsFileLimit, isLargeFile } from "@/lib/audit/file-kinds";
import type { InspectSummary, ResultFilter, RunProgress, RunSummary, Slot, UploadCheckSummary } from "@/lib/audit/pipeline";
import { AuditWorkerClient } from "@/lib/audit/worker-client";
import Brand, { APP_NAME } from "./Brand";
import { useConfirm } from "./ConfirmDialog";
import { loadSampleFile } from "@/lib/audit/sample-loader";
import FileDropCard, { EMPTY_CARD, type FileCardState } from "./FileDropCard";
import NoticeBox from "./NoticeBox";
import DownloadButtons from "./DownloadButtons";
import ProgressBar from "./ProgressBar";
import ResultSummary from "./ResultSummary";
import ResultTable from "./ResultTable";

/** 점검 중 창을 닫으려 할 때 (브라우저가 자체 문구를 보여주므로 이 문구는 일부 브라우저에서만 보인다) */
const LEAVE_WARNING = "진행 중인 점검이 사라집니다";

type Cards = Record<Slot, FileCardState>;

const CARD_TEXT: Record<Slot, { title: string; hint: string; optional?: boolean }> = {
  lease: { title: "대부계약 현황", hint: "「대부계약 현황 통계 보고서」 (엑셀·CSV·TXT)" },
  survey: { title: "실태조사 내역", hint: "「최근 실태조사 내역 현황 통계 보고서」 (엑셀·CSV·TXT)" },
  mapping: { title: "대응표", hint: "이용현황 문장 → 분류를 적은 표. 있으면 그 문장은 AI에 묻지 않습니다", optional: true },
};

const SLOTS: Slot[] = ["lease", "survey", "mapping"];

function cardFromSummary(summary: InspectSummary, slotError: string | null): FileCardState {
  const isMapping = summary.slot === "mapping";
  const recognizedAs = isMapping ? "대응표" : summary.report ? REPORT_NAMES[summary.report] : null;
  const sizeText = recognizedAs ? `${summary.rowCount.toLocaleString("ko-KR")}${isMapping ? "개 문장" : "행"}` : null;
  const notices: FileCardState["notices"] = [];
  if (slotError) notices.push({ tone: "error", text: slotError });
  for (const text of summary.notices) {
    if (text === slotError) continue;
    notices.push({ tone: isMapping ? "warn" : "info", text });
  }
  return { fileName: summary.fileName, loading: false, recognizedAs, sizeText, notices };
}

interface AuditAppProps {
  /** 고른 점검 세트 (이름·샘플 파일) */
  checkSet: CheckSetInfo;
  /** 점검 세트 고르는 첫 화면으로 돌아가기 */
  onBack: () => void;
}

export default function AuditApp({ checkSet, onBack }: AuditAppProps) {
  const { ask, dialog } = useConfirm();
  const clientRef = useRef<AuditWorkerClient | null>(null);
  const runningRef = useRef(false);
  const [cards, setCards] = useState<Cards>({ lease: EMPTY_CARD, survey: EMPTY_CARD, mapping: EMPTY_CARD });
  const [check, setCheck] = useState<UploadCheckSummary | null>(null);
  const [customerColumnFound, setCustomerColumnFound] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [sampleError, setSampleError] = useState<string | null>(null);
  // 점검 방식: 온라인(AI 분류 사용) / 오프라인(AI 호출 없이 대응표만 사용)
  const [offline, setOffline] = useState(false);
  const [result, setResult] = useState<RunSummary | null>(null);
  const [progress, setProgress] = useState<RunProgress | null>(null);
  // 점검을 새로 끝낼 때마다 올라가는 번호: 결과 목록을 처음 상태로 되돌리는 데 쓴다
  const [runId, setRunId] = useState(0);
  // AI 요청을 다시 보내는 중이면 그 안내 (성공하면 지운다)
  const [retryNote, setRetryNote] = useState<string | null>(null);
  // 마지막에 살펴본 파일 정보(칸별). 칸 오류 문구를 합칠 때 쓴다
  const summaries = useRef<Partial<Record<Slot, InspectSummary>>>({});

  // 작업자는 처음 필요할 때 만들고, 화면을 떠날 때 끈다
  function client(): AuditWorkerClient {
    if (!clientRef.current) clientRef.current = new AuditWorkerClient();
    return clientRef.current;
  }
  useEffect(() => {
    return () => {
      clientRef.current?.terminate();
      clientRef.current = null;
    };
  }, []);

  // 점검이 도는 동안에만 창 닫기·새로고침을 막고 확인을 받는다
  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = LEAVE_WARNING;
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  const loadResults = useCallback((filter: ResultFilter, page: number) => client().results(filter, page), []);
  const makeResultFile = useCallback(() => client().exportFile("result"), []);
  const makeMappingFile = useCallback(() => client().exportFile("mapping"), []);
  const setCard = (slot: Slot, card: FileCardState) => setCards((prev) => ({ ...prev, [slot]: card }));

  /** 작업자(Web Worker)가 죽었는지 (대개 메모리 부족). 죽으면 읽어 둔 파일도 사라진다 */
  const isCrash = (e: unknown) => e instanceof Error && e.name === "WorkerCrashed";

  /** 작업자를 새로 만들고 칸·결과를 모두 비운 뒤 안내한다 */
  function resetAfterCrash() {
    clientRef.current?.terminate();
    clientRef.current = null;
    summaries.current = {};
    setCards({ lease: EMPTY_CARD, survey: EMPTY_CARD, mapping: EMPTY_CARD });
    setCheck(null);
    setResult(null);
    setProgress(null);
    setRunError(UPLOAD_MESSAGES.workerCrashed);
  }

  /** 칸을 화면과 작업자 양쪽에서 비우고 두 보고서를 다시 맞춰 본다 */
  async function clearSlotEverywhere(slot: Slot) {
    const c = client();
    await c.clear(slot);
    delete summaries.current[slot];
    setCard(slot, EMPTY_CARD);
    if (slot !== "mapping") await refreshCheck(c);
  }

  /** 두 보고서를 맞춰 보고, 칸 오류가 있으면 카드에 반영한다 (비우라는 오류는 칸을 비우되 문구는 남긴다) */
  async function refreshCheck(c: AuditWorkerClient) {
    const next = await c.check();
    setCheck(next);
    for (const slot of ["lease", "survey"] as const) {
      const error = next.slotErrors[slot === "lease" ? "leaseSlot" : "surveySlot"];
      const summary = summaries.current[slot];
      if (!summary) continue;
      if (error?.clear) {
        await c.clear(slot);
        delete summaries.current[slot];
        setCard(slot, { ...EMPTY_CARD, notices: [{ tone: "error", text: `${summary.fileName}: ${error.message}` }] });
      } else {
        setCard(slot, cardFromSummary(summary, error?.message ?? null));
      }
    }
    // 고객명 열 확인 결과는 대부계약으로 알아본 파일 기준
    const leaseSummary = [summaries.current.lease, summaries.current.survey].find((s) => s?.report === "lease");
    setCustomerColumnFound(leaseSummary ? (leaseSummary.customerNameColumnFound ?? null) : null);
  }

  async function handleFile(slot: Slot, file: File) {
    setResult(null);
    setRunError(null);
    if (!detectFileKind(file.name)) {
      // 카드만 비우면 작업자에 이전 파일이 남아, 보이지 않는 파일로 점검될 수 있다: 작업자의 칸도 함께 비운다
      setBusy(true);
      try {
        await clearSlotEverywhere(slot);
      } catch (e) {
        if (isCrash(e)) resetAfterCrash();
      } finally {
        setBusy(false);
      }
      setCard(slot, { ...EMPTY_CARD, notices: [{ tone: "error", text: `${file.name}: ${UPLOAD_MESSAGES.unsupportedType}` }] });
      return;
    }
    if (exceedsFileLimit(file.name, file.size)) {
      setCard(slot, { ...EMPTY_CARD, notices: [{ tone: "error", text: `${file.name}: ${UPLOAD_MESSAGES.fileTooBig}` }] });
      return;
    }
    if (isLargeFile(file.name, file.size) && !(await ask(UPLOAD_MESSAGES.largeFile, "계속 올리기"))) return;

    setBusy(true);
    setCard(slot, { ...EMPTY_CARD, fileName: file.name, loading: true });
    const c = client();
    try {
      const summary = await c.inspect(slot, file);
      summaries.current[slot] = summary;
      if (slot === "mapping") setCard(slot, cardFromSummary(summary, null));
      else await refreshCheck(c);
    } catch (e) {
      if (isCrash(e)) {
        resetAfterCrash();
        return;
      }
      delete summaries.current[slot];
      await c.clear(slot).catch(() => {});
      setCard(slot, {
        ...EMPTY_CARD,
        notices: [{ tone: "error", text: `${file.name}: ${e instanceof Error ? e.message : "파일을 읽지 못했습니다"}` }],
      });
      if (slot !== "mapping") await refreshCheck(c).catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  /** 가상 샘플 파일을 칸에 자동으로 넣는다 (사람이 파일을 골라 올리는 것과 같은 길로 읽는다) */
  async function handleSample() {
    setSampleError(null);
    try {
      // 어디서 실행하든 가져오도록 후보 주소를 차례로 시도한다 (sample-loader.ts)
      const files = await Promise.all(checkSet.samples.map(async (s) => ({ slot: s.slot, file: await loadSampleFile(s) })));
      for (const { slot, file } of files) await handleFile(slot, file);
    } catch (e) {
      setSampleError(e instanceof Error ? e.message : "샘플 파일을 넣지 못했습니다");
    }
  }

  /** 샘플 대응표를 대응표 칸에 자동으로 넣는다 (대응표 샘플은 위 가상 샘플 두 파일에 맞춰 만든 것이다) */
  async function handleMappingSample() {
    const sample = checkSet.mappingSample;
    if (!sample) return;
    setSampleError(null);
    try {
      await handleFile("mapping", await loadSampleFile(sample));
    } catch (e) {
      setSampleError(e instanceof Error ? e.message : "샘플 대응표를 넣지 못했습니다");
    }
  }

  async function handleClear(slot: Slot) {
    setResult(null);
    setRunError(null);
    setBusy(true);
    try {
      await clearSlotEverywhere(slot);
    } catch (e) {
      if (isCrash(e)) resetAfterCrash();
      else setRunError(e instanceof Error ? e.message : "파일을 지우지 못했습니다");
    } finally {
      setBusy(false);
    }
  }

  async function handleRun() {
    // 거의 동시에 두 번 눌러도 점검은 한 번만 시작한다 (화면 상태가 바뀌기를 기다리지 않고 바로 막는다)
    if (runningRef.current) return;
    if (customerColumnFound === false && !(await ask(UPLOAD_MESSAGES.noCustomerColumn, "그래도 점검"))) return;
    // 오프라인인데 대응표가 없으면 모든 이용현황이 판단 불가가 되므로 먼저 확인한다
    if (offline && !cards.mapping.recognizedAs && !(await ask(UPLOAD_MESSAGES.offlineNoMapping, "그래도 점검"))) return;
    runningRef.current = true;
    setBusy(true);
    setRunning(true);
    setRunError(null);
    setResult(null);
    setRetryNote(null);
    setProgress({ stage: "match", done: 0, total: 0 });
    try {
      setResult(
        await client().run({
          offline,
          onProgress: (p) => {
            setProgress(p);
            if (p.stage === "classify" && p.done > 0) setRetryNote(null);
          },
          onRetry: (info) =>
            setRetryNote(`AI 연결이 불안정해 ${Math.max(1, Math.round(info.delayMs / 1000))}초 뒤 다시 시도합니다 (${info.attempt}번째)`),
        }),
      );
      setProgress({ stage: "done", done: 0, total: 0 });
      setRunId((n) => n + 1);
    } catch (e) {
      if (isCrash(e)) {
        resetAfterCrash();
      } else {
        setRunError(e instanceof Error ? e.message : "점검 중 문제가 생겼습니다");
        setProgress(null);
      }
    } finally {
      runningRef.current = false;
      setRunning(false);
      setBusy(false);
      setRetryNote(null);
    }
  }

  /** 첫 화면(점검 세트 고르기)으로 돌아간다. 파일·결과는 저장되지 않으므로, 결과가 있으면 사라진다고 먼저 알린다 */
  async function goMain() {
    if (result && !(await ask("첫 화면으로 돌아가면 지금 결과가 사라집니다. 결과 엑셀을 먼저 내려받으셨나요?", "첫 화면으로"))) return;
    onBack();
  }

  // 칸에 걸리지 않은 안내: 칸 바꿔 맞춤·옮겨 맞춤(안내), 같은 종류(오류)
  const pairNotices: { tone: "info" | "error"; text: string }[] = [];
  if (check?.pairError) pairNotices.push({ tone: "error", text: check.pairError });
  for (const text of check?.notices ?? []) pairNotices.push({ tone: "info", text });

  const canRun = !!check?.ready && !busy;

  return (
    <div className="flex flex-1 flex-col">
      <header className="ui-topbar">
        <Brand onClick={busy ? undefined : () => void goMain()} />
        <button
          type="button"
          disabled={busy}
          onClick={() => void goMain()}
          className="ui-btn px-4 py-1.5 text-sm"
        >
          Main
        </button>
      </header>

      <section className="ui-hero ui-hero--small">
        <p className="ui-eyebrow">{APP_NAME} · Audit check</p>
        <h1 className="ui-title">{checkSet.name}</h1>
        <p className="ui-lede" style={{ marginTop: 12 }}>
          파일은 이 컴퓨터(브라우저) 안에서만 읽습니다. 서버로는 고객명·주민번호·전화번호를 가린 이용현황 문장만 보냅니다.
        </p>
      </section>

      <main className="app-main flex-1">
        <section className="app-card">
          <h2 className="text-lg font-semibold">
            <span className="app-step">1</span>파일 올리기
          </h2>
          <div className="mt-3">
            <NoticeBox tone="info">{UPLOAD_MESSAGES.sizeGuide}</NoticeBox>
          </div>
          {checkSet.samples.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleSample()}
                className="ui-btn px-3 py-1.5 text-sm"
              >
                샘플 파일 자동으로 넣기
              </button>
              {checkSet.mappingSample && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleMappingSample()}
                  className="ui-btn px-3 py-1.5 text-sm"
                >
                  대응표 샘플 넣기
                </button>
              )}
              <span className="text-xs text-foreground/60">
                시험용 샘플 데이터(가상 데이터 또는 개인정보를 지운 데이터)를 두 칸에 넣어 바로 시험해 볼 수 있습니다. [대응표 샘플 넣기]는 샘플에 맞는 대응표를 대응표 칸에 넣습니다(오프라인 방식 시험용). 실제 점검 자료가 아닙니다.
              </span>
            </div>
          )}
          {sampleError && (
            <div className="mt-2">
              <NoticeBox tone="error">{sampleError}</NoticeBox>
            </div>
          )}
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {SLOTS.map((slot) => (
              <FileDropCard
                key={slot}
                {...CARD_TEXT[slot]}
                state={cards[slot]}
                disabled={busy}
                onFile={(file) => void handleFile(slot, file)}
                onClear={() => void handleClear(slot)}
              />
            ))}
          </div>
          {pairNotices.length > 0 && (
            <div className="mt-4 flex flex-col gap-2">
              {pairNotices.map((n, i) => (
                <NoticeBox key={i} tone={n.tone}>
                  {n.text}
                </NoticeBox>
              ))}
            </div>
          )}
        </section>

        <section className="app-card">
          <h2 className="text-lg font-semibold">
            <span className="app-step">2</span>점검 실행
          </h2>
          <fieldset className="app-seg mt-3" disabled={busy}>
            <legend className="sr-only">점검 방식</legend>
            <label>
              <input type="radio" name="mode" checked={!offline} onChange={() => setOffline(false)} />
              <span>
                <strong>온라인</strong>
                <small>AI로 이용현황을 분류합니다</small>
              </span>
            </label>
            <label>
              <input type="radio" name="mode" checked={offline} onChange={() => setOffline(true)} />
              <span>
                <strong>오프라인</strong>
                <small>AI 없이 대응표만 씁니다 (업무망용)</small>
              </span>
            </label>
          </fieldset>
          {offline && (
            <p className="mt-2 text-sm text-foreground/70">{UPLOAD_MESSAGES.offlineGuide}</p>
          )}
          <button
            type="button"
            disabled={!canRun}
            onClick={() => void handleRun()}
            className="mt-3 ui-btn px-7 py-2.5 font-medium"
          >
            {running ? "점검 중…" : "점검 실행"}
          </button>
          {!check?.ready && !running && (
            <p className="mt-2 text-sm text-foreground/60">대부계약 현황과 실태조사 내역을 모두 올리면 누를 수 있습니다.</p>
          )}
        </section>

        <section className="app-card">
          <h2 className="text-lg font-semibold">
            <span className="app-step">3</span>진행 상황
          </h2>
          {progress ? (
            <div className="mt-3">
              <ProgressBar progress={progress} note={retryNote} />
              {running && <p className="mt-2 text-xs text-foreground/60">점검 중에는 이 창을 닫지 마세요. 닫으면 처음부터 다시 해야 합니다.</p>}
            </div>
          ) : (
            <p className="mt-3 rounded-md border border-dashed border-foreground/20 px-4 py-4 text-center text-sm text-foreground/60">
              점검을 실행하면 진행률이 여기에 표시됩니다.
            </p>
          )}
          {runError && (
            <div className="mt-3">
              <NoticeBox tone="error">{runError}</NoticeBox>
              {check?.ready && <p className="mt-2 text-xs text-foreground/60">파일은 그대로 있으니 [점검 실행]을 다시 누르면 처음부터 다시 점검합니다.</p>}
            </div>
          )}
        </section>

        <section className="app-card" id="audit-results">
          <h2 className="text-lg font-semibold">
            <span className="app-step">4</span>결과
          </h2>
          {result ? (
            <ResultSummary
              total={result.leaseRows}
              counts={result.counts}
              ruleCounts={result.ruleCounts}
              violationByCategory={result.violationByCategory}
              offline={result.offline}
            />
          ) : (
            <p className="mt-3 rounded-md border border-dashed border-foreground/20 px-4 py-4 text-center text-sm text-foreground/60">
              점검이 끝나면 결과 요약, 목록, 내려받기 버튼이 여기에 표시됩니다.
            </p>
          )}
          {result?.offline && (
            <div className="mt-3">
              <NoticeBox tone="info">{UPLOAD_MESSAGES.offlineResult(result.unclassifiedOffline)}</NoticeBox>
            </div>
          )}
          {result && (
            <>
              <DownloadButtons key={`d${runId}`} makeResult={makeResultFile} makeMapping={makeMappingFile} />
              <ResultTable key={runId} counts={result.counts} load={loadResults} />
            </>
          )}
        </section>
      </main>

      {dialog}

    </div>
  );
}
