// 수정 내용을 GitHub에 올리고 Vercel에 다시 배포한 뒤, 잘 올라갔는지 확인한다.
// 사용: npm run ship -- "무엇을 왜 바꿨는지 한 줄 (한국어)"
//
// 순서: ① 바뀐 파일 확인 → ② 타입 검사·코드 검사 → ③ 비밀 값·금지 파일 검사 → ④ 업무망 반입용 폴더(offline-package) 다시 만들기
//       → ⑤ 커밋 → ⑥ GitHub push → ⑦ Vercel 프로덕션 배포 → ⑧ GitHub·배포 주소 확인
// (offline-package는 저장소에 올리지 않는 빌드 결과다. 기능이 바뀌면 같이 새로 만들어 두려고 매번 다시 만든다. 건너뛰려면 --skip-package)
// 하나라도 실패하면 거기서 멈춘다(검사에 실패한 채로는 올리지 않는다). 토큰·키 값은 화면에 출력하지 않는다.
// GitHub는 .env의 GITHUB_TOKEN, Vercel은 VERCEL_TOKEN을 쓴다. Vercel CLI는 컴퓨터에 전역 설치(npm i -g vercel)돼 있어야 한다.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const redeploy = argv.includes("--redeploy");
const message = argv.filter((a) => !a.startsWith("--")).join(" ").trim();
const LIVE_URL = "https://auditmate-ten.vercel.app";
const APP_TITLE = "AuditMate";

const step = (n, text) => console.log(`\n[${n}/8] ${text}`);
const fail = (text) => {
  console.error(`\n✖ 중단: ${text}`);
  process.exit(1);
};

// .env에서 값 읽기 (출력하지 않는다)
function readEnv() {
  const file = path.join(root, ".env");
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs.readFileSync(file, "utf8").split(/\r?\n/).filter((l) => /^[A-Za-z_]\w*=/.test(l)).map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
  );
}
const env = readEnv();
const scrub = (text) => {
  let out = String(text ?? "");
  for (const v of Object.values(env)) if (v && v.length >= 8) out = out.split(v).join("***");
  return out;
};

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: root, shell: opts.shell ?? false, encoding: "utf8", env: { ...process.env, ...(opts.env ?? {}) }, maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status ?? 1, out: scrub(r.stdout), err: scrub(r.stderr) };
}
const git = (...args) => run("git", args);
const node = (...args) => run(process.execPath, args);

// ① 바뀐 파일
step(1, "바뀐 파일 확인");
if (!message) fail('커밋 메시지가 필요합니다. 예: npm run ship -- "결과 표에 소재지 열 추가"');
const status = git("status", "--short").out.trim();
const head = git("rev-parse", "HEAD").out.trim();
const remoteHead = git("ls-remote", "origin", "refs/heads/main").out.split(/\s+/)[0];
if (!status && head === remoteHead) {
  console.log("바뀐 파일이 없고 GitHub와도 같습니다. 배포만 다시 하려면 `--redeploy`를 쓰세요.");
  if (!redeploy) process.exit(0);
}
console.log(status ? status : "(커밋할 변경 없음, push·배포만 진행)");

// ② 검사
step(2, "타입 검사·코드 검사");
const tsc = node(path.join(root, "node_modules/typescript/bin/tsc"), "--noEmit");
if (tsc.status !== 0) fail("타입 검사 실패\n" + (tsc.out + tsc.err).slice(0, 1500));
const lint = node(path.join(root, "node_modules/eslint/bin/eslint.js"), ".");
if (lint.status !== 0) fail("코드 검사(lint) 실패\n" + (lint.out + lint.err).slice(0, 1500));
console.log("통과: tsc, lint");

// ③ 비밀 값·금지 파일
step(3, "비밀 값·금지 파일 검사");
git("add", "-A");
const staged = git("ls-files").out.split("\n").filter(Boolean);
const forbidden = staged.filter((p) => /(^|\/)\.env|node_modules\/|^data\/|^trash-can\/|^offline-package\/|^\.vercel\/|\.pem$/.test(p));
if (forbidden.length) fail("올라가면 안 되는 파일이 포함됨: " + forbidden.join(", "));
const leaked = [];
for (const [key, value] of Object.entries(env)) {
  if (!value || value.length < 8) continue;
  const r = git("grep", "--cached", "-I", "-F", "-l", "-e", value);
  if (r.out.trim()) leaked.push(key);
}
if (leaked.length) fail("비밀 값이 올라갈 파일 안에 들어 있음: " + leaked.join(", ") + " (파일 위치는 git grep으로 직접 확인)");
const patterns = ["sk-[A-Za-z0-9_-]{20,}", "ghp_[A-Za-z0-9]{20,}", "github_pat_[A-Za-z0-9_]{20,}", "sbp_[A-Za-z0-9]{20,}"];
for (const p of patterns) {
  if (git("grep", "--cached", "-I", "-E", "-l", "-e", p).out.trim()) fail(`비밀 값 모양(${p.slice(0, 8)}…)이 올라갈 파일에서 발견됨`);
}
console.log(`통과: 올라갈 파일 ${staged.length}개, 비밀 값 0건, 금지 경로 0건`);

// ④ 업무망 반입용 폴더
step(4, "업무망 반입용 폴더(offline-package) 다시 만들기");
if (argv.includes("--skip-package")) {
  console.log("건너뜀(--skip-package)");
} else {
  const pkg = node(path.join(root, "scripts/make-offline-package.mjs"));
  if (pkg.status !== 0) fail("반입용 폴더 만들기 실패: " + (pkg.out + pkg.err).slice(-1200));
  console.log((pkg.out.trim().split(/\r?\n/).pop() ?? "").trim() || "완료");
}

// ⑤ 커밋
step(5, "커밋");
if (git("status", "--short").out.trim()) {
  const name = git("log", "-1", "--format=%an").out.trim() || "sanghopark89";
  const email = git("log", "-1", "--format=%ae").out.trim();
  if (!/@users\.noreply\.github\.com$/.test(email)) fail("커밋 작성자가 GitHub 공용 noreply 주소가 아닙니다. 개인 이메일이 공개되지 않게 확인하세요.");
  const c = git("-c", `user.name=${name}`, "-c", `user.email=${email}`, "-c", "core.autocrlf=false", "commit", "-q", "-m", message, "-m", "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>");
  if (c.status !== 0) fail("커밋 실패\n" + (c.out + c.err).slice(0, 800));
  console.log("커밋:", git("log", "-1", "--format=%h %s").out.trim());
} else {
  console.log("새로 커밋할 내용 없음");
}

// ⑥ push
step(6, "GitHub push");
if (!env.GITHUB_TOKEN) fail(".env에 GITHUB_TOKEN이 없습니다");
const b64 = Buffer.from(`x-access-token:${env.GITHUB_TOKEN}`).toString("base64");
const push = git("-c", `http.extraheader=Authorization: Basic ${b64}`, "push", "-q", "origin", "main");
if (push.status !== 0) fail("push 실패\n" + (push.out + push.err).slice(0, 800));
console.log("push 완료");

// ⑦ Vercel 배포
step(7, "Vercel 프로덕션 배포 (1~2분)");
// Windows에서는 npm이 npm.cmd라서 shell로 실행해야 찾는다. 못 찾으면 기본 전역 폴더(%APPDATA%\npm)를 쓴다
const npmRoot = run("npm", ["root", "-g"], { shell: true }).out.trim();
const globalRoot = npmRoot || path.join(process.env.APPDATA ?? "", "npm", "node_modules");
const vc = process.env.VERCEL_CLI || path.join(globalRoot, "vercel", "dist", "vc.js");
if (!fs.existsSync(vc)) fail("Vercel CLI가 없습니다. `npm install -g vercel` 후 다시 실행하세요.");
if (!env.VERCEL_TOKEN) fail(".env에 VERCEL_TOKEN이 없습니다");
const deploy = run(process.execPath, [vc, "deploy", "--prod", "--yes"], { env: { VERCEL_TOKEN: env.VERCEL_TOKEN } });
const deployText = deploy.out + deploy.err;
if (deploy.status !== 0) fail("배포 실패\n" + deployText.slice(-1500));
const ready = deployText.match(/Deployment ([^\s]+) ready\. Production URL: (https:\/\/[^\s"]+)/);
console.log(ready ? `배포 완료: ${ready[1]}` : "배포 명령은 성공했습니다.");

// ⑧ 확인
step(8, "GitHub·배포 주소 확인");
const after = git("ls-remote", "origin", "refs/heads/main").out.split(/\s+/)[0];
const localHead = git("rev-parse", "HEAD").out.trim();
const githubOk = after === localHead;
console.log(`GitHub: 로컬 ${localHead.slice(0, 7)} / 원격 ${after.slice(0, 7)} → ${githubOk ? "같음 ✅" : "다름 ❌"}`);
let liveOk = false;
for (let i = 0; i < 6 && !liveOk; i++) {
  try {
    const res = await fetch(LIVE_URL + "/", { headers: { "cache-control": "no-cache" } });
    const html = await res.text();
    liveOk = res.status === 200 && html.includes(APP_TITLE);
    console.log(`배포 주소: ${res.status}, 제목 ${html.includes(APP_TITLE) ? "확인 ✅" : "없음 ❌"}`);
  } catch {
    console.log("배포 주소 응답 없음, 다시 시도…");
  }
  if (!liveOk) await new Promise((r) => setTimeout(r, 5000));
}
console.log(`\n결과: GitHub ${githubOk ? "✅" : "❌"} / 배포 ${liveOk ? "✅" : "❌"}  →  ${LIVE_URL}`);
process.exit(githubOk && liveOk ? 0 : 1);
