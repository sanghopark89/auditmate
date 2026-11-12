// 계획 작업 14 / 설계 §2.1 — 화면 쪽에서 점검 작업자를 부리는 도구
//
// 화면 부품(작업 15~)은 이 클래스로 파일을 올리고 점검을 시키고 진행 상황을 받는다.
// 파일은 복사하지 않고 작업자에 넘긴다(transfer). 점검을 중간에 멈추려면 terminate()로 작업자를 끄는데,
// 그러면 작업자가 읽어 둔 파일도 사라지므로 화면은 올린 파일(File)로 다시 inspect해야 한다.

import type { ClassifyRetryInfo } from "./classify-client";
import type { InspectSummary, ResultFilter, ResultPage, RunProgress, RunSummary, Slot, UploadCheckSummary } from "./pipeline";
import type { WorkerError, WorkerRequest, WorkerResponse } from "./worker-protocol";

/** 작업자에서 난 오류를 화면에서 다루기 쉽게 감싼 것. message는 안내 문구, name·code로 종류를 알아본다 */
export class AuditWorkerError extends Error {
  code?: string;

  constructor(source: WorkerError) {
    super(source.message);
    this.name = source.name;
    this.code = source.code;
  }
}

// 요청에서 id만 뺀 모양 (id는 보내는 쪽에서 붙인다). 요청 종류마다 따로 빼야 해서 이렇게 쓴다
type RequestBody = WorkerRequest extends infer R ? (R extends unknown ? Omit<R, "id"> : never) : never;

export interface RunHandlers {
  onProgress?: (progress: RunProgress) => void;
  onRetry?: (info: ClassifyRetryInfo) => void;
  /** 분류 요청 주소. 기본 "/api/classify" */
  endpoint?: string;
  /** 오프라인 모드: AI에 묻지 않고 대응표만 쓴다 */
  offline?: boolean;
}

interface Pending {
  resolve: (response: WorkerResponse) => void;
  reject: (error: Error) => void;
  handlers?: RunHandlers;
}

export class AuditWorkerClient {
  private worker: Worker | null;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  /** workerFactory를 주면 그 작업자를 쓴다 (시험용). 기본은 이 폴더의 worker.ts */
  constructor(workerFactory?: () => Worker) {
    this.worker = workerFactory ? workerFactory() : new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.handle(event.data);
    this.worker.onerror = (event) => {
      // 작업자가 죽거나 시작하지 못한 경우: 기다리던 요청을 모두 실패로 알린다
      const error = new AuditWorkerError({ name: "WorkerCrashed", message: event.message || "점검 작업자가 멈췄습니다" });
      this.rejectAll(error);
    };
  }

  private handle(response: WorkerResponse): void {
    const entry = this.pending.get(response.id);
    if (!entry) return;
    if (response.type === "progress") return entry.handlers?.onProgress?.(response.progress);
    if (response.type === "retry") return entry.handlers?.onRetry?.(response.info);
    this.pending.delete(response.id);
    if (response.type === "error") entry.reject(new AuditWorkerError(response.error));
    else entry.resolve(response);
  }

  private rejectAll(error: Error): void {
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
  }

  /** 짧게 끝나야 하는 요청(칸 비우기·맞춰 보기·목록 쪽 받기)의 기다림 한도(밀리초). 넘으면 작업자가 멈춘 것으로 본다 */
  private static readonly QUICK_TIMEOUT_MS = 30_000;

  private send(request: RequestBody, handlers?: RunHandlers, transfer: Transferable[] = [], timeoutMs?: number): Promise<WorkerResponse> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new AuditWorkerError({ name: "WorkerClosed", message: "점검 작업자가 꺼져 있습니다" }));
    const id = this.nextId++;
    return new Promise<WorkerResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, handlers });
      if (timeoutMs !== undefined) {
        // 오류 알림도 없이 작업자가 죽은 경우를 알아채기 위한 시간 제한
        const timer = setTimeout(() => {
          if (!this.pending.delete(id)) return;
          reject(new AuditWorkerError({ name: "WorkerCrashed", message: "점검 작업자가 응답하지 않습니다" }));
        }, timeoutMs);
        const done = this.pending.get(id)!;
        const origResolve = done.resolve;
        const origReject = done.reject;
        done.resolve = (r) => { clearTimeout(timer); origResolve(r); };
        done.reject = (e) => { clearTimeout(timer); origReject(e); };
      }
      worker.postMessage({ ...request, id } as WorkerRequest, transfer);
    });
  }

  /** 파일 하나를 올려 살펴본다. 파일 내용은 복사하지 않고 작업자에 넘긴다 */
  async inspect(slot: Slot, file: File): Promise<InspectSummary> {
    const buffer = await file.arrayBuffer();
    const response = await this.send({ type: "inspect", slot, fileName: file.name, buffer }, undefined, [buffer]);
    if (response.type !== "inspected") throw new AuditWorkerError({ name: "ProtocolError", message: "작업자 응답이 올바르지 않습니다" });
    return response.summary;
  }

  /** 올라와 있는 두 보고서를 맞춰 본다 */
  async check(): Promise<UploadCheckSummary> {
    const response = await this.send({ type: "check" }, undefined, [], AuditWorkerClient.QUICK_TIMEOUT_MS);
    if (response.type !== "checked") throw new AuditWorkerError({ name: "ProtocolError", message: "작업자 응답이 올바르지 않습니다" });
    return response.check;
  }

  /** 칸에 올렸던 파일을 작업자에서 치운다 */
  async clear(slot: Slot): Promise<void> {
    const response = await this.send({ type: "clear", slot }, undefined, [], AuditWorkerClient.QUICK_TIMEOUT_MS);
    if (response.type !== "cleared") throw new AuditWorkerError({ name: "ProtocolError", message: "작업자 응답이 올바르지 않습니다" });
  }

  /** 점검 결과 목록의 한 쪽을 받아 온다 (고객명·문장은 이미 가려진 상태) */
  async results(filter: ResultFilter, page: number): Promise<ResultPage> {
    const response = await this.send({ type: "results", filter, page }, undefined, [], AuditWorkerClient.QUICK_TIMEOUT_MS);
    if (response.type !== "resultPage") throw new AuditWorkerError({ name: "ProtocolError", message: "작업자 응답이 올바르지 않습니다" });
    return response.page;
  }

  /** 결과 엑셀을 만들어 받아 온다 */
  async exportFile(kind: "result" | "mapping" = "result"): Promise<{ fileName: string; blob: Blob }> {
    const response = await this.send({ type: "export", kind });
    if (response.type !== "exported") throw new AuditWorkerError({ name: "ProtocolError", message: "작업자 응답이 올바르지 않습니다" });
    return {
      fileName: response.fileName,
      blob: new Blob([response.buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    };
  }

  /** 점검을 끝까지 돌린다. 진행 상황은 handlers.onProgress로 온다 */
  async run(handlers: RunHandlers = {}): Promise<RunSummary> {
    const response = await this.send({ type: "run", endpoint: handlers.endpoint, offline: handlers.offline }, handlers);
    if (response.type !== "done") throw new AuditWorkerError({ name: "ProtocolError", message: "작업자 응답이 올바르지 않습니다" });
    return response.summary;
  }

  /** 작업자를 끈다. 점검 중이면 즉시 멈추고, 기다리던 요청은 모두 실패로 끝난다 */
  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    this.rejectAll(new AuditWorkerError({ name: "WorkerClosed", message: "점검을 멈췄습니다" }));
  }
}
