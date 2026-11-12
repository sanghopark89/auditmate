"use client";

// 계획 작업 15 / 설계 §5.2 — 파일 하나를 올리는 칸 (눌러서 고르거나 끌어다 놓기)

import { useRef, useState } from "react";
import NoticeBox, { type NoticeTone } from "./NoticeBox";

export interface FileCardState {
  fileName: string | null;
  /** 읽는 중 */
  loading: boolean;
  /** 알아본 보고서 이름 (대응표 칸이면 "대응표") */
  recognizedAs: string | null;
  /** "12,345행"처럼 보여줄 규모 */
  sizeText: string | null;
  notices: { tone: NoticeTone; text: string }[];
}

export const EMPTY_CARD: FileCardState = { fileName: null, loading: false, recognizedAs: null, sizeText: null, notices: [] };

interface Props {
  title: string;
  hint: string;
  optional?: boolean;
  state: FileCardState;
  disabled: boolean;
  onFile: (file: File) => void;
  onClear: () => void;
}

export default function FileDropCard({ title, hint, optional, state, disabled, onFile, onClear }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function pick(files: FileList | null) {
    const file = files?.[0];
    if (file) onFile(file);
    // 같은 파일을 다시 골라도 반응하도록 비운다
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div
      className={`flex flex-col gap-3 rounded-2xl border p-4 ${dragging ? "border-foreground bg-foreground/5" : "border-foreground/20"}`}
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!disabled) pick(e.dataTransfer.files);
      }}
    >
      <div>
        <h3 className="font-semibold">
          {title}
          {optional && <span className="ml-2 text-xs font-normal text-foreground/60">(선택)</span>}
        </h3>
        <p className="mt-1 text-xs text-foreground/60">{hint}</p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.csv,.txt"
        className="sr-only"
        aria-label={`${title} 파일 고르기`}
        disabled={disabled}
        onChange={(e) => pick(e.target.files)}
      />

      {state.fileName ? (
        <div className="text-sm">
          <p className="break-all font-medium">{state.fileName}</p>
          <p className="mt-1 text-foreground/70">
            {state.loading ? "읽는 중…" : [state.recognizedAs, state.sizeText].filter(Boolean).join(" · ")}
          </p>
        </div>
      ) : (
        <p className="rounded-md border border-dashed border-foreground/25 px-3 py-4 text-center text-sm text-foreground/60">
          여기로 파일을 끌어다 놓거나 아래 버튼을 누르세요
        </p>
      )}

      {state.notices.map((n, i) => (
        <NoticeBox key={i} tone={n.tone}>
          {n.text}
        </NoticeBox>
      ))}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="rounded-md border border-foreground/30 px-3 py-1.5 text-sm hover:bg-foreground/5 disabled:opacity-50"
        >
          {state.fileName ? "다른 파일 고르기" : "파일 고르기"}
        </button>
        {state.fileName && (
          <button
            type="button"
            disabled={disabled}
            onClick={onClear}
            className="rounded-md px-3 py-1.5 text-sm text-foreground/70 underline hover:text-foreground disabled:opacity-50"
          >
            지우기
          </button>
        )}
      </div>
    </div>
  );
}
