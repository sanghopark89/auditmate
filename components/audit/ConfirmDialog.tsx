"use client";

// 화면 안에 직접 그리는 확인 대화상자. 브라우저 기본 확인 창(window.confirm)은 환경에 따라 뜨지 않고
// 곧바로 "취소"로 처리돼 버튼이 먹통처럼 보일 수 있어서, 같은 역할을 화면 안에서 한다.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

interface Pending {
  message: string;
  confirmLabel: string;
  resolve: (ok: boolean) => void;
}

/** ask(문구)를 await하면 확인 true, 취소 false가 돌아온다. dialog는 화면 어딘가에 한 번 그려 둔다 */
export function useConfirm(): { ask: (message: string, confirmLabel?: string) => Promise<boolean>; dialog: ReactNode } {
  const [pending, setPending] = useState<Pending | null>(null);
  const okRef = useRef<HTMLButtonElement>(null);

  const ask = useCallback(
    (message: string, confirmLabel = "확인") =>
      new Promise<boolean>((resolve) => {
        setPending({ message, confirmLabel, resolve });
      }),
    [],
  );

  const close = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  useEffect(() => {
    if (!pending) return;
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        pending.resolve(false);
        setPending(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending]);

  const dialog = pending ? (
    <div className="ui-modal-backdrop" onClick={() => close(false)}>
      <div className="ui-modal" role="alertdialog" aria-modal="true" aria-label="확인" onClick={(e) => e.stopPropagation()}>
        <p>{pending.message}</p>
        <div className="ui-modal-actions">
          <button type="button" className="rounded-full border border-foreground/30 px-5 py-2 text-sm" onClick={() => close(false)}>
            취소
          </button>
          <button ref={okRef} type="button" className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background" onClick={() => close(true)}>
            {pending.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { ask, dialog };
}
