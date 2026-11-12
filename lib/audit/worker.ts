// 계획 작업 14 / 설계 §2.1·§10.2 — 점검 작업자(Web Worker)
//
// 화면과 따로 돌아가는 작업자다. 화면은 이 작업자에 파일을 넘기고 점검을 시키며, 무거운 계산(파일 읽기·짝짓기·
// 가리기·판정)은 모두 여기서 한다. 그래서 100만 건을 처리하는 동안에도 화면(버튼·스크롤·진행률 막대)이 멈추지 않는다.
// 실제 흐름은 pipeline.ts에 있고, 이 파일은 메시지를 받아 그 흐름을 부르는 얇은 껍데기다.

import { ClassifyAbortedError, ClassifyFailedError } from "./classify-client";
import { AuditError, AuditSession } from "./pipeline";
import type { WorkerError, WorkerRequest, WorkerResponse } from "./worker-protocol";
import { ReadFileError } from "./read-file";

// 작업자 안에서 쓰는 전역(self)의 필요한 부분만 적는다 (화면용 타입에는 작업자 전용 postMessage가 없다)
const scope = self as unknown as {
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
};

const session = new AuditSession();
let running = false; // 점검이 도는 동안에는 파일을 새로 올리거나 다시 실행하지 못하게 막는다

/** 작업자가 쓰는 자바스크립트 메모리(MB). Chrome 계열 브라우저만 알려 주고, 아니면 undefined */
function heapMb(): number | undefined {
  const memory = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory;
  return memory?.usedJSHeapSize === undefined ? undefined : Math.round(memory.usedJSHeapSize / 1048576);
}

function toWorkerError(error: unknown): WorkerError {
  if (error instanceof ReadFileError || error instanceof AuditError || error instanceof ClassifyFailedError) {
    return { name: error.name, code: error.code, message: error.message };
  }
  if (error instanceof ClassifyAbortedError) return { name: error.name, message: error.message };
  // 예상하지 못한 오류(메모리 부족 포함). 안내 문구만 보내고 자세한 내용은 작업자 콘솔에 남긴다
  console.error("[audit-worker] 예상하지 못한 오류", error);
  return { name: "UnexpectedError", message: "점검 중 문제가 생겼습니다. 파일이 너무 크면 나누어 올려 주세요" };
}

scope.onmessage = async (event) => {
  const request = event.data;
  const reply = (response: WorkerResponse) => scope.postMessage(response);
  try {
    if (running && request.type !== "check") {
      reply({
        id: request.id,
        type: "error",
        error: { name: "AuditError", code: "BUSY", message: "점검이 진행 중입니다. 끝난 뒤에 다시 시도해 주세요" },
      });
      return;
    }
    switch (request.type) {
      case "inspect": {
        const summary = session.inspect(request.slot, request.fileName, new Uint8Array(request.buffer));
        reply({ id: request.id, type: "inspected", summary: { ...summary, heapMb: heapMb() } });
        break;
      }
      case "check":
        reply({ id: request.id, type: "checked", check: session.checkSummary() });
        break;
      case "clear":
        session.clear(request.slot);
        reply({ id: request.id, type: "cleared" });
        break;
      case "results":
        reply({ id: request.id, type: "resultPage", page: session.listResults(request.filter, request.page) });
        break;
      case "export": {
        const { fileName, bytes } = request.kind === "mapping" ? session.exportMapping() : session.exportResult();
        // 만든 파일은 복사하지 않고 화면으로 넘긴다(transfer)
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        scope.postMessage({ id: request.id, type: "exported", fileName, buffer }, [buffer]);
        break;
      }
      case "run": {
        running = true;
        try {
          const summary = await session.run({
            endpoint: request.endpoint,
            offline: request.offline,
            onProgress: (progress) => reply({ id: request.id, type: "progress", progress }),
            onRetry: (info) => reply({ id: request.id, type: "retry", info }),
          });
          reply({ id: request.id, type: "done", summary: { ...summary, heapMb: heapMb() } });
        } finally {
          running = false;
        }
        break;
      }
    }
  } catch (error) {
    reply({ id: request.id, type: "error", error: toWorkerError(error) });
  }
};
