"use client";

// AuditMate 인트로: 앱을 처음 열 때 남색 화면에서 로고가 그려지고(A → 체크) 이름이 나타난 뒤 첫 화면으로 넘어간다.
//  - 한 탭에서 한 번만 보여 준다 (sessionStorage). 클릭·아무 키·"건너뛰기"로 바로 넘길 수 있다.
//  - "동작 줄이기" 설정이면 보여 주지 않는다.
//  - 처음에는 남색 바탕만 깔아 두어 첫 화면이 번쩍 보이는 일이 없게 한다.

import { useEffect, useState } from "react";
import { APP_NAME_KO } from "./Brand";

const SEEN_KEY = "auditmate-intro-seen";
/** 인트로가 끝나고 사라지기 시작하는 시간(ms) / 완전히 치워지는 시간(ms) */
const OUT_AT = 3400;
const DONE_AT = 4100;

type Phase = "pending" | "play" | "out" | "done";

const WORD_AUDIT = [..."Audit"];
const WORD_MATE = [..."Mate"];

export default function Intro() {
  const [phase, setPhase] = useState<Phase>("pending");

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    // 보여 줄지 정하는 일은 타이머 안에서 한다 (효과 본문에서 바로 상태를 바꾸지 않는다)
    timers.push(
      setTimeout(() => {
        let seen = false;
        try {
          seen = sessionStorage.getItem(SEEN_KEY) === "1";
        } catch {
          /* 저장소를 못 써도 인트로는 그대로 보여 준다 */
        }
        if (seen || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          setPhase("done");
          return;
        }
        try {
          sessionStorage.setItem(SEEN_KEY, "1");
        } catch {
          /* 무시 */
        }
        setPhase("play");
        timers.push(setTimeout(() => setPhase("out"), OUT_AT));
      }, 0),
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  // 건너뛰기: 아무 키나 누르면 바로 넘어간다
  useEffect(() => {
    if (phase !== "play") return;
    const skip = () => setPhase("out");
    window.addEventListener("keydown", skip);
    return () => window.removeEventListener("keydown", skip);
  }, [phase]);

  // 사라지는 중에 건너뛰면 남은 시간표가 어긋나지 않게, out 단계에서 따로 치운다
  useEffect(() => {
    if (phase !== "out") return;
    const t = setTimeout(() => setPhase("done"), DONE_AT - OUT_AT);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === "done") return null;

  return (
    <div className="ui-intro" data-phase={phase} aria-hidden={phase !== "play"} onClick={() => phase === "play" && setPhase("out")}>
      <div className="ui-intro-inner">
        <svg className="ui-intro-logo" width="120" height="120" viewBox="0 0 140 140" aria-hidden="true">
          <rect className="ui-intro-tile" width="140" height="140" rx="34" fill="#29A7E1" />
          <path className="ui-intro-a" d="M30 108L70 32L110 108" pathLength="100" fill="none" stroke="#fff" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
          <path className="ui-intro-check" d="M54 90l12 12l24-28" pathLength="100" fill="none" stroke="#F6B93B" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="ui-intro-word" aria-label="AuditMate">
          {WORD_AUDIT.map((c, i) => (
            <span key={`a${i}`} style={{ ["--i" as string]: i }}>
              {c}
            </span>
          ))}
          {WORD_MATE.map((c, i) => (
            <span key={`m${i}`} className="ui-intro-mate" style={{ ["--i" as string]: WORD_AUDIT.length + i }}>
              {c}
            </span>
          ))}
        </div>
        <span className="ui-intro-line" />
        <p className="ui-intro-sub">{APP_NAME_KO}</p>
      </div>
      <button type="button" className="ui-intro-skip" onClick={(e) => { e.stopPropagation(); setPhase("out"); }}>
        건너뛰기
      </button>
    </div>
  );
}
