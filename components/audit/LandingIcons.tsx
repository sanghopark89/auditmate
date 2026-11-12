// 첫 화면 기능 카드의 평면(플랫) 그림 3종. 이미지 파일 없이 SVG로 직접 그렸고, 파스텔 바탕 위에 놓인다.
// 입장 애니메이션이 찾도록 data-part 속성을 달아 두었다.

const NAVY = "#0C1C37";
const SKY = "#29A7E1";
const SKY_LIGHT = "#9ED8F2";
const SUN = "#F6B93B";

/** 1. 안전한 파일 처리: 방패와 자물쇠, 옆의 파일 */
export function ShieldIcon() {
  return (
    <svg viewBox="0 0 150 130" role="img" aria-label="방패와 자물쇠" data-part="shield">
      <rect x="12" y="36" width="40" height="52" rx="6" fill="#fff" stroke={NAVY} strokeWidth="2.5" />
      <path d="M20 52h24M20 62h24M20 72h14" stroke={SKY_LIGHT} strokeWidth="4" strokeLinecap="round" />
      <path d="M92 12l38 12v32c0 26-16 44-38 54-22-10-38-28-38-54V24z" fill={SKY} stroke={NAVY} strokeWidth="3" strokeLinejoin="round" />
      <rect x="78" y="56" width="28" height="24" rx="5" fill="#fff" stroke={NAVY} strokeWidth="3" />
      <path d="M84 56v-7a8 8 0 0 1 16 0v7" fill="none" stroke={NAVY} strokeWidth="3" strokeLinecap="round" />
      <circle cx="92" cy="68" r="3.5" fill={SUN} />
    </svg>
  );
}

/** 2. 이용현황 분류와 판정: Ai 말풍선과 막대 */
export function JudgeIcon() {
  return (
    <svg viewBox="0 0 150 130" role="img" aria-label="AI 말풍선과 막대 그래프" data-part="judge">
      <path d="M18 24a14 14 0 0 1 14-14h54a14 14 0 0 1 14 14v36a14 14 0 0 1-14 14H52l-16 14V74h-4a14 14 0 0 1-14-14z" fill={SKY} />
      <text x="59" y="52" textAnchor="middle" fontSize="26" fontWeight="800" fill="#fff" fontFamily="Montserrat, sans-serif">
        Ai
      </text>
      <rect x="92" y="80" width="12" height="30" rx="3" fill={SKY_LIGHT} />
      <rect x="108" y="64" width="12" height="46" rx="3" fill={NAVY} />
      <rect x="124" y="48" width="12" height="62" rx="3" fill={SUN} />
      <path d="M14 114h126" stroke={NAVY} strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

/** 3. 결과 엑셀 보고서: 겹친 문서와 확인 표시 */
export function ReportIcon() {
  return (
    <svg viewBox="0 0 150 130" role="img" aria-label="점검 결과 문서" data-part="report">
      <rect x="34" y="16" width="62" height="84" rx="7" fill="#fff" stroke={NAVY} strokeWidth="2.5" transform="rotate(-6 65 58)" />
      <rect x="46" y="20" width="62" height="86" rx="7" fill="#fff" stroke={NAVY} strokeWidth="2.5" />
      <path d="M58 40h38M58 52h38M58 64h26" stroke={SKY_LIGHT} strokeWidth="4" strokeLinecap="round" />
      <circle cx="104" cy="94" r="18" fill={SUN} stroke={NAVY} strokeWidth="3" />
      <path d="M95 94l7 7 12-14" stroke={NAVY} strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}
