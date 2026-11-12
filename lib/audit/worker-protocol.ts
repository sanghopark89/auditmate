// 계획 작업 14 / 설계 §2.1 — 화면(브라우저 본 줄기)과 작업자(Web Worker)가 주고받는 메시지의 모양
//
// 화면은 파일을 작업자에 넘기고(inspect), 점검을 시키고(run), 진행 상황을 받는다.
// 파일 내용과 점검 결과 전체는 작업자 안에만 있고, 화면에는 요약만 온다.

import type { ClassifyRetryInfo } from "./classify-client";
import type { InspectSummary, ResultFilter, ResultPage, RunProgress, RunSummary, Slot, UploadCheckSummary } from "./pipeline";

/** 화면 → 작업자 */
export type WorkerRequest =
  /** 파일 하나를 올림. buffer는 복사하지 않고 넘긴다(transfer) */
  | { id: number; type: "inspect"; slot: Slot; fileName: string; buffer: ArrayBuffer }
  /** 올라와 있는 두 보고서를 맞춰 봐 달라 (칸 바뀜·같은 종류·열 빠짐 등) */
  | { id: number; type: "check" }
  /** 칸에 올렸던 파일을 치워 달라 */
  | { id: number; type: "clear"; slot: Slot }
  /** 점검 결과 목록의 한 쪽을 달라 */
  | { id: number; type: "results"; filter: ResultFilter; page: number }
  /** 결과 엑셀을 만들어 달라 */
  | { id: number; type: "export"; kind?: "result" | "mapping" }
  /** 점검을 끝까지 돌려 달라 */
  | { id: number; type: "run"; endpoint?: string; offline?: boolean };

/** 작업자 → 화면 */
export type WorkerResponse =
  | { id: number; type: "inspected"; summary: InspectSummary }
  | { id: number; type: "checked"; check: UploadCheckSummary }
  | { id: number; type: "cleared" }
  | { id: number; type: "resultPage"; page: ResultPage }
  | { id: number; type: "exported"; fileName: string; buffer: ArrayBuffer }
  | { id: number; type: "progress"; progress: RunProgress }
  | { id: number; type: "retry"; info: ClassifyRetryInfo }
  | { id: number; type: "done"; summary: RunSummary }
  | { id: number; type: "error"; error: WorkerError };

/** 작업자에서 난 오류 (화면에 안내할 message와, 종류를 알아볼 name·code) */
export interface WorkerError {
  name: string;
  code?: string;
  message: string;
}
