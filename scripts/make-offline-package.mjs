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

// 3) 실행 파일과 안내
console.log("3/4 실행 파일 만드는 중…");
fs.writeFileSync(
  path.join(out, "실행.bat"),
  [
    "@echo off",
    "chcp 65001 >nul",
    "rem AuditMate 실행: 이 창을 열어 둔 동안 http://localhost:3000 으로 접속합니다. 끝내려면 이 창을 닫으세요.",
    "set PORT=3000",
    "set HOSTNAME=127.0.0.1",
    "rem 다른 PC에서도 접속하게 하려면 위 HOSTNAME 을 0.0.0.0 으로 바꾸세요.",
    "node server.js",
    "pause",
    "",
  ].join("\r\n"),
);
fs.writeFileSync(
  path.join(out, "start.sh"),
  ["#!/bin/sh", "PORT=${PORT:-3000} HOSTNAME=${HOSTNAME:-127.0.0.1} exec node server.js", ""].join("\n"),
);
fs.writeFileSync(
  path.join(out, "README.txt"),
  [
    "AuditMate (AI 감사업무 도우미) — 업무망 반입용",
    "",
    "1. 이 PC에 Node.js 가 설치돼 있어야 합니다 (이 폴더에는 들어 있지 않습니다).",
    "2. 실행.bat 을 더블클릭 (Linux/Mac은 sh start.sh).",
    "3. 브라우저에서 http://localhost:3000 을 엽니다.",
    "4. 점검 화면에서 [오프라인] 방식을 고르고, 대응표 엑셀을 올려서 점검합니다.",
    "",
    "- 오프라인 방식은 AI(인터넷)를 쓰지 않습니다. 비밀 키 파일(.env)도 필요 없고, 이 폴더에는 들어 있지 않습니다.",
    "- 대응표는 인터넷이 되는 환경에서 [온라인] 방식으로 만든 뒤 반입합니다.",
    "- 점검 결과와 대응표는 서버에 저장되지 않고, 내려받은 파일로만 남습니다.",
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
