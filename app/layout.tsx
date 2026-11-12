import type { Metadata } from "next";
import "./globals.css";

// 브라우저 탭에 보이는 앱 이름과 설명 (계획 작업 1)
export const metadata: Metadata = {
  title: "AuditMate · AI 감사업무 도우미",
  description:
    "AuditMate: 감사 자료를 AI와 정해진 규칙으로 점검하고 결과를 엑셀로 돌려주는 감사업무 도우미",
  // 공개 주소가 검색에 잡혀 무작위 호출이 늘지 않도록 색인을 막는다
  robots: { index: false, follow: false },
};

// 모든 화면을 감싸는 공통 틀 (설계 §10.2: 앱 제목·한국어 설정)
// 글꼴은 외부 서버에서 받지 않고 컴퓨터에 있는 한글 글꼴을 쓴다 (globals.css 참고)
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
