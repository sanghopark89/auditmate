// 업무망 반입용 폴더 만들기 (OFFLINE.md)
//
// 하는 일: ① NEXT_OUTPUT=standalone 으로 빌드 ② 실행에 필요한 파일만 offline-package/ 로 복사
//          ③ 비밀 값 파일(.env*)은 절대 넣지 않는다 ④ 실행 안내(README.txt)와 실행 파일(실행.bat, start.sh)을 함께 넣는다
// 사용: npm run package:offline   →  offline-package 폴더를 통째로 압축해서 반입한다.
// 업무망 PC에는 Node.js가 설치돼 있어야 한다 (이 폴더에는 Node.js가 들어 있지 않다).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "offline-package");
const isSecret = (name) => /^\.env(\.|$)/i.test(name) || /\.(pem|key)$/i.test(name);

// 1) 빌드 (경로에 & 가 있어도 되게 node 로 직접 실행)
console.log("1/4 standalone 빌드 중…");
const build = spawnSync(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "build"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, NEXT_OUTPUT: "standalone" },
});
if (build.status !== 0) {
  console.error("빌드에 실패했습니다.");
  process.exit(build.status ?? 1);
}

// 2) 새로 채우기 (이전 결과는 지우지 않고 trash-can 으로 옮긴다)
if (fs.existsSync(out)) {
  const trash = path.join(root, "trash-can");
  fs.mkdirSync(trash, { recursive: true });
  fs.renameSync(out, path.join(trash, `offline-package-${Date.now()}`));
}
console.log("2/4 파일 복사 중 (비밀 값 파일 제외)…");
const copy = (from, to) =>
  fs.cpSync(from, to, { recursive: true, filter: (src) => !isSecret(path.basename(src)) });
copy(path.join(root, ".next/standalone"), out);
copy(path.join(root, "public"), path.join(out, "public"));
copy(path.join(root, ".next/static"), path.join(out, ".next/static"));

// 2-1) 샘플을 실제 형식 시험 데이터로 바꾼다 (사용자 결정 2026-11-12, 업무망 반입용 폴더에만 적용)
//   data/ 폴더(저장소에 올라가지 않는 개인정보를 지운 실제 형식 샘플)가 있으면, 반입용 폴더의 "샘플 파일 자동으로 넣기"·"대응표 샘플 넣기"가
//   그 파일을 쓰게 한다. 앱이 샘플을 가져오는 주소는 그대로 두고 그 자리의 파일 내용만 바꾼다. 공개 저장소·Vercel 배포의 샘플은 가상 데이터 그대로다.
//   (data/대응표.xlsx에는 제3자 이름이 일부 남아 있어 공개하지 않는다. 반입용 폴더도 업무망 안에서만 쓰고 밖으로 반출하지 않는다.)
//   건너뛰려면 --virtual
const REAL_SAMPLES = [
  ["대부계약현황샘플.xlsx", "lease"],
  ["보유대장실태조사현황샘플.xlsx", "survey"],
  ["대응표.xlsx", "mapping"],
];
let realSamples = false;
if (process.argv.includes("--virtual")) {
  console.log("샘플: 가상 데이터 그대로 사용 (--virtual)");
} else if (REAL_SAMPLES.every(([file]) => fs.existsSync(path.join(root, "data", file)))) {
  for (const [file, name] of REAL_SAMPLES) {
    const source = path.join(root, "data", file);
    fs.copyFileSync(source, path.join(out, "public", "samples", name + ".xlsx"));
    const media = path.join(out, ".next", "static", "media");
    for (const f of fs.readdirSync(media)) {
      if (f.startsWith(name + ".") && f.endsWith(".xlsx")) fs.copyFileSync(source, path.join(media, f));
    }
  }
  realSamples = true;
  console.log("샘플: data 폴더의 실제 형식 시험 데이터 3개로 교체 (대부계약·실태조사·대응표)");
} else {
  console.log("샘플: data 폴더의 샘플 파일이 없어 가상 데이터 그대로 사용");
}

// 3) 실행 파일과 안내
console.log("3/4 실행 파일 만드는 중…");
fs.writeFileSync(
  path.join(out, "실행.bat"),
  [
    "@echo off",
    "chcp 65001 >nul",
    "title AuditMate (이 창을 닫으면 프로그램이 종료됩니다)",
    "rem AuditMate 실행: 더블클릭하면 서버가 켜지고 잠시 뒤 브라우저가 자동으로 열립니다. 끝내려면 이 창을 닫으세요.",
    'cd /d "%~dp0"',
    "where node >nul 2>nul",
    "if errorlevel 1 (",
    "  echo [오류] Node.js가 설치되어 있지 않습니다. 먼저 Node.js를 설치한 뒤 다시 실행해 주세요.",
    "  pause",
    "  exit /b 1",
    ")",
    "rem 다른 PC에서도 접속하게 하려면 아래 HOSTNAME 을 0.0.0.0 으로 바꾸세요. (Windows가 HOSTNAME을 컴퓨터 이름으로 쓰므로 항상 직접 지정합니다)",
    "set HOSTNAME=127.0.0.1",
    "rem 3000번이 이미 쓰이고 있으면 비어 있는 다음 번호(3001, 3002…)를 자동으로 고릅니다. 직접 정하려면 실행 전에 PORT를 지정하세요.",
    "if not defined PORT (",
    '  for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "$p=3000; while (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue) { $p++ }; $p"`) do set PORT=%%p',
    ")",
    "if not defined PORT set PORT=3000",
    "echo AuditMate를 시작합니다...",
    "echo 주소: http://localhost:%PORT%",
    "echo (잠시 뒤 브라우저가 자동으로 열립니다. 끝내려면 이 창을 닫으세요.)",
    "rem 서버가 준비되면 기본 브라우저로 자동으로 엽니다. AUDITMATE_NO_BROWSER 를 지정하면 열지 않습니다.",
    `if not defined AUDITMATE_NO_BROWSER start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for ($i=0; $i -lt 60; $i++) { try { Invoke-WebRequest -Uri 'http://127.0.0.1:%PORT%/' -UseBasicParsing -TimeoutSec 1 | Out-Null; Start-Process 'http://localhost:%PORT%/'; break } catch { Start-Sleep -Milliseconds 500 } }"`,
    "node server.js",
    "if errorlevel 1 (",
    "  echo.",
    "  echo [오류] 프로그램이 시작되지 않았거나 중간에 멈췄습니다. 위의 오류 문구를 확인해 주세요.",
    "  pause",
    ")",
    "",
  ].join("\r\n"),
);
fs.writeFileSync(
  path.join(out, "start.sh"),
  [
    "#!/bin/sh",
    'cd "$(dirname "$0")"',
    "export PORT=${PORT:-3000} HOSTNAME=${HOSTNAME:-127.0.0.1}",
    "# 서버가 준비되면 기본 브라우저를 엽니다 (있을 때만). AUDITMATE_NO_BROWSER 를 지정하면 열지 않습니다.",
    'if [ -z "$AUDITMATE_NO_BROWSER" ]; then',
    '  ( sleep 3; (xdg-open "http://localhost:$PORT/" || open "http://localhost:$PORT/") >/dev/null 2>&1 ) &',
    "fi",
    "exec node server.js",
    "",
  ].join("\n"),
);
fs.writeFileSync(
  path.join(out, "README.txt"),
  [
    "AuditMate (AI 감사업무 도우미) — 업무망 반입용",
    "",
    "1. 이 PC에 Node.js 가 설치돼 있어야 합니다 (이 폴더에는 들어 있지 않습니다).",
    "2. 실행.bat 을 더블클릭 (Linux/Mac은 sh start.sh). 잠시 뒤 브라우저가 자동으로 열립니다.",
    "3. 브라우저가 안 열리면 검은 창에 표시된 주소(보통 http://localhost:3000)를 직접 엽니다. 3000번이 이미 쓰이면 3001, 3002… 번호가 자동으로 쓰입니다.",
    "4. 점검 화면에서 [오프라인] 방식을 고르고, 대응표 엑셀을 올려서 점검합니다.",
    "",
    "- 오프라인 방식은 AI(인터넷)를 쓰지 않습니다. 비밀 키 파일(.env)도 필요 없고, 이 폴더에는 들어 있지 않습니다.",
    "- 대응표는 인터넷이 되는 환경에서 [온라인] 방식으로 만든 뒤 반입합니다.",
    "- 점검 결과와 대응표는 서버에 저장되지 않고, 내려받은 파일로만 남습니다.",
    ...(realSamples
      ? ["- [주의] 이 폴더의 샘플 파일(샘플 파일 자동으로 넣기·대응표 샘플 넣기)은 개인정보를 지운 실제 형식 시험 데이터입니다. 업무망 안에서만 쓰고 밖으로 반출하지 마세요."]
      : []),
    "- 다른 PC에서도 접속하게 하려면 실행.bat 의 HOSTNAME 을 0.0.0.0 으로 바꾸고 방화벽을 확인하세요.",
    "",
  ].join("\r\n"),
);

// 4) 비밀 값 파일이 정말 없는지 한 번 더 확인
console.log("4/4 비밀 값 파일 검사…");
const found = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (isSecret(entry.name)) found.push(path.relative(out, full));
    if (entry.isDirectory()) walk(full);
  }
};
walk(out);
if (found.length > 0) {
  console.error("비밀 값 파일이 들어 있어 중단합니다:", found);
  process.exit(1);
}
const size = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).reduce((sum, e) => {
    const p = path.join(dir, e.name);
    return sum + (e.isDirectory() ? size(p) : fs.statSync(p).size);
  }, 0);
console.log(`완료: ${out} (${(size(out) / 1024 / 1024).toFixed(1)}MB). 이 폴더를 압축해 반입하세요.`);
