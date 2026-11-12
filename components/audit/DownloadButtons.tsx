"use client";

// 계획 작업 19·20 / 설계 §5.1 — 내려받기 버튼 두 개 (점검이 끝난 뒤에만 보인다)
// 결과 엑셀·대응표 엑셀은 작업자가 브라우저 안에서 만들고, 서버를 거치지 않고 바로 내려받는다.

import { useState } from "react";
import NoticeBox from "./NoticeBox";

type MakeFile = () => Promise<{ fileName: string; blob: Blob }>;

interface Props {
  makeResult: MakeFile;
  makeMapping: MakeFile;
}

/** 브라우저에서 파일을 바로 내려받게 한다 */
function saveBlob(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 내려받기가 시작될 시간을 준 뒤 메모리를 돌려준다
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export default function DownloadButtons({ makeResult, makeMapping }: Props) {
  const [busy, setBusy] = useState<"result" | "mapping" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(kind: "result" | "mapping") {
    setBusy(kind);
    setError(null);
    try {
      const { fileName, blob } = await (kind === "result" ? makeResult() : makeMapping());
      saveBlob(fileName, blob);
    } catch (e) {
      setError(e instanceof Error ? e.message : "엑셀을 만들지 못했습니다");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-5">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void download("result")}
          className="rounded-full bg-foreground px-5 py-2 text-sm text-background disabled:opacity-40"
        >
          {busy === "result" ? "엑셀 만드는 중…" : "결과 엑셀 내려받기"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void download("mapping")}
          className="rounded-full border border-foreground/40 px-5 py-2 text-sm disabled:opacity-40"
        >
          {busy === "mapping" ? "엑셀 만드는 중…" : "대응표 엑셀 내려받기"}
        </button>
      </div>
      <ul className="mt-2 list-disc pl-5 text-xs text-foreground/60">
        <li>결과 엑셀: 원본 「대부계약 현황」에 실태조사 이용현황·점검결과·판정사유 열 3개만 덧붙입니다. 원본과 같은 자료이므로 고객명이 가려지지 않으니 내부 업무용으로만 쓰세요.</li>
        <li>대응표 엑셀: 이번에 쓴 이용현황 문장과 분류입니다. 분류를 고쳐서 다음 점검 때 올리면 고친 분류가 그대로 쓰이고, 같은 결과를 다시 얻을 수 있습니다.</li>
      </ul>
      {error && (
        <div className="mt-2">
          <NoticeBox tone="error">{error}</NoticeBox>
        </div>
      )}
    </div>
  );
}
