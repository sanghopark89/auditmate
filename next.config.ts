import type { NextConfig } from "next";

// 보안 헤더 (보안 점검 결과 반영). nonce 없이 쓰는 방식이라 인라인 스크립트는 허용하되(Next 기본 동작),
// 다른 사이트의 스크립트·액자(iframe) 삽입, 외부로의 몰래 전송(connect-src)을 막는다.
// 파일 읽기 작업자는 같은 사이트의 스크립트(worker-src 'self' blob:)만 쓴다. 개발 서버는 실시간 갱신 때문에 조금 더 허용한다.
const isDev = process.env.NODE_ENV === "development";
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // 업무망 반입용 빌드: NEXT_OUTPUT=standalone 으로 빌드하면 실행에 필요한 파일만 .next/standalone 에 모인다 (OFFLINE.md).
  // 환경변수가 없으면 평소처럼 빌드되므로 Vercel 배포에는 영향이 없다.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
