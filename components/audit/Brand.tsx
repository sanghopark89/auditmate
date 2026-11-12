// 앱 이름표: 로고(A + 체크) + 영문 이름 AuditMate + 한글 이름. 첫 화면과 점검 화면의 맨 위 띠에서 함께 쓴다.
// 로고 모양은 app/icon.svg(브라우저 탭 아이콘)와 같다.

export const APP_NAME = "AuditMate";
export const APP_NAME_KO = "AI 감사업무 도우미";

/** 하늘색 둥근 사각형 안에 A, A 속에 체크(검증)를 넣은 로고 */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 140 140" role="img" aria-label={`${APP_NAME} 로고`}>
      <rect width="140" height="140" rx="34" fill="#29A7E1" />
      <path d="M30 108L70 32L110 108" fill="none" stroke="#fff" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M54 90l12 12l24-28" fill="none" stroke="#F6B93B" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** onClick이 있으면 눌러서 첫 화면으로 돌아가는 버튼이 되고, 없으면 그냥 이름표다 */
export default function Brand({ onClick }: { onClick?: () => void }) {
  const inner = (
    <>
      <Logo />
      <span className="ui-brand-text">
        {APP_NAME}
        <small>{APP_NAME_KO}</small>
      </span>
    </>
  );
  if (!onClick) return <span className="ui-brand">{inner}</span>;
  return (
    <button type="button" className="ui-brand" style={{ cursor: "pointer" }} onClick={onClick} aria-label={`${APP_NAME} 첫 화면으로`}>
      {inner}
    </button>
  );
}
