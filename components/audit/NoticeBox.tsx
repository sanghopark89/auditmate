// 계획 작업 15 / 설계 §6.1 — 안내·경고·오류 문구 상자
// 색만으로 구분하지 않도록 앞에 글자 표시(안내/주의/오류)를 함께 붙인다.

export type NoticeTone = "info" | "warn" | "error";

const TONE_STYLE: Record<NoticeTone, { box: string; label: string }> = {
  info: { box: "border-foreground/20 bg-foreground/5", label: "안내" },
  warn: { box: "border-amber-500/50 bg-amber-500/10", label: "주의" },
  error: { box: "border-red-500/50 bg-red-500/10", label: "오류" },
};

export default function NoticeBox({ tone, children }: { tone: NoticeTone; children: React.ReactNode }) {
  const style = TONE_STYLE[tone];
  return (
    // 오류는 바로 읽어 주도록 alert, 나머지는 status
    <p role={tone === "error" ? "alert" : "status"} className={`rounded-md border px-3 py-2 text-sm ${style.box}`}>
      <strong className="mr-2">{style.label}</strong>
      {children}
    </p>
  );
}
