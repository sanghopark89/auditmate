"use client";

// 첫 화면: 앱 소개(핵심 기능 3가지) + 점검 세트 고르기.
// 점검 세트는 lib/audit/checksets.ts 목록에서 가져오므로, 항목을 추가하면 카드가 늘어난다(지금은 1종).
// 디자인은 app/globals.css의 ui- 클래스 참고. 입장 애니메이션은 한 번만 돌고, "동작 줄이기" 설정이면 돌리지 않는다.

import { useEffect, useRef, type ReactNode } from "react";
import { CHECKSETS, type CheckSetInfo } from "@/lib/audit/checksets";
import Brand, { APP_NAME } from "./Brand";
import { JudgeIcon, ReportIcon, ShieldIcon } from "./LandingIcons";

interface Props {
  onPick: (checkSet: CheckSetInfo) => void;
}

const FEATURES: { title: string; text: string; icon: ReactNode; tone: "mint" | "blue" | "peach" }[] = [
  {
    title: "안전한 파일 처리",
    text: "올린 파일은 이 컴퓨터(브라우저) 안에서만 읽습니다. AI에는 이름·주민번호·전화번호를 가린 문장만 보내고, 결과는 서버에 저장하지 않습니다.",
    icon: <ShieldIcon />,
    tone: "mint",
  },
  {
    title: "AI 분류 + 규칙 판정",
    text: "AI는 문장을 분류하는 일만 맡고, 최종 판정은 정해진 규칙이 합니다. 판정 사유를 함께 적어 주고, 애매한 건은 검토 필요로 남깁니다.",
    icon: <JudgeIcon />,
    tone: "blue",
  },
  {
    title: "엑셀로 받는 결과",
    text: "원본 엑셀의 값과 순서는 그대로 두고 점검 결과 열만 덧붙여 줍니다. 대응표를 받아 두면 다음 점검에 다시 쓸 수 있고, 같은 결과를 얻습니다.",
    icon: <ReportIcon />,
    tone: "peach",
  },
];

/** 입장 애니메이션: 제목 → 설명 → 카드 → 점검 세트(읽는 순서). 한 번만 돌고 처음 값으로 채운다(backwards) */
function playEntrance(root: HTMLElement) {
  const q = (sel: string) => Array.from(root.querySelectorAll<HTMLElement>(sel));
  const ease = "cubic-bezier(.2,.7,.2,1)";
  const rise = (el: HTMLElement, delay: number, dist = 16, duration = 700) =>
    el.animate(
      [
        { opacity: 0, transform: `translateY(${dist}px)` },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration, delay, easing: ease, fill: "backwards" },
    );
  q("[data-a=hero]").forEach((el, i) => rise(el, 100 + i * 150, 18, 800));
  q("[data-a=card]").forEach((el, i) => {
    const delay = 400 + i * 130;
    rise(el, delay, 22, 750);
    // 그림은 카드가 올라온 뒤 한 번 살짝 커지며 나타난다
    el.querySelector<HTMLElement>("[data-part]")?.animate(
      [
        { opacity: 0, transform: "scale(.8)" },
        { opacity: 1, transform: "scale(1)" },
      ],
      { duration: 700, delay: delay + 250, easing: ease, fill: "backwards" },
    );
  });
  q("[data-a=picker]").forEach((el) => rise(el, 900, 18, 700));
}

/** 바로 아래의 점검 세트 고르는 곳으로 부드럽게 내려간다 ("동작 줄이기" 설정이면 바로 이동) */
function scrollToCheckSet() {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.getElementById("check-set")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

export default function CheckSetPicker({ onPick }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    playEntrance(root);
  }, []);

  return (
    <div ref={rootRef} className="flex flex-1 flex-col">
      <header className="ui-topbar">
        <Brand />
        <span className="ui-topnote">파일은 브라우저 안에서만 읽습니다</span>
      </header>

      <section className="ui-hero">
        <h1 className="ui-title ui-title--brand" data-a="hero">
          <em>{APP_NAME}</em>
          audit made clear
        </h1>
        <p className="ui-lede" data-a="hero">
          감사 자료를 올리면 AI와 정해진 규칙으로 점검하고, 결과를 엑셀로 돌려드리는 감사 도우미입니다. 점검 세트를 골라 바로 시작하세요.
        </p>
        <button type="button" className="ui-scroll" data-a="hero" aria-label="점검 세트 고르는 곳으로 이동" onClick={scrollToCheckSet}>
          <span className="ui-scroll-ring">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </span>
          <span className="ui-scroll-label">SCROLL</span>
        </button>
      </section>

      <section className="ui-band ui-band--paper" aria-labelledby="feat-title">
        <div className="ui-wrap">
          <div className="ui-sechead" data-a="hero">
            <h2 id="feat-title">Why {APP_NAME}</h2>
            <p>어떤 점검 세트를 쓰든 {APP_NAME}가 똑같이 지켜 주는 약속입니다.</p>
          </div>
          <ul className="ui-features">
            {FEATURES.map((f) => (
              <li key={f.title} className="ui-feature" data-a="card">
                <div className={`ui-feature-art ui-feature-art--${f.tone}`}>{f.icon}</div>
                <div className="ui-feature-body">
                  <h3>{f.title}</h3>
                  <p>{f.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="check-set" className="ui-band ui-band--sky" aria-labelledby="pick-title" data-a="picker">
        <div className="ui-wrap">
          <div className="ui-sechead">
            <h2 id="pick-title">Check set</h2>
            <p>{APP_NAME}와 함께할 점검 세트를 고르세요. 고르면 파일을 올리는 화면으로 넘어갑니다.</p>
          </div>
          <ul className="ui-sets">
            {CHECKSETS.map((set) => (
              <li key={set.id}>
                <button type="button" className="ui-set" onClick={() => onPick(set)}>
                  <span className="ui-set-name">{set.name}</span>
                  <span className="ui-set-summary">{set.summary}</span>
                  <span className="ui-set-files">필요한 파일: {set.inputs.join(" · ")}</span>
                  <span className="ui-set-go">이 점검 시작하기 →</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <footer className="ui-footer">
        {APP_NAME} · AI 감사업무 도우미
        <br />
        점검 결과와 대응표는 서버에 저장하지 않고, 내려받은 파일로만 남습니다. 실제 자료는 기관의 정보보호 규정을 확인한 뒤 사용하세요.
      </footer>
    </div>
  );
}
