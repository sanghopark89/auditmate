// 계획 작업 3 / 설계 §9.5 — 가상 시험 데이터 만들기 (실제 형식 샘플 기준, 2026-11-12 개정)
//
// 사용자가 준 실제 형식의 샘플 파일(data 폴더, 개인정보를 지운 파일)과 같은 모양으로,
// 대부계약 현황·실태조사 내역의 "가상" 파일과 일부러 넣은 사례의 정답지를 만든다.
// 실제 감사 데이터는 쓰지 않는다(PRD 7번). 이름·번호·주소는 모두 지어낸 값이다.
// 값의 종류(대부목적·상세용도·이용현황 문장 등)는 실제 샘플 파일에서 본 것을 따랐다.
// 같은 명령을 다시 실행하면 항상 같은 파일이 만들어진다(고정된 난수 씨앗 사용).
//
// 실제 형식에서 따온 것
//  - 대부계약: 시트 "기준일자별(명세)", 맨 위 13줄은 "필터 차원 | 조건 값" 표, 14번째 줄이 제목 줄(19개 열),
//    같은 대장번호가 여러 행(고객이 다른 계약), 날짜는 "20250101" 같은 글자
//  - 실태조사: 시트 "명세", 맨 위 4줄이 필터 표, 5번째 줄이 제목 줄(15개 열), 대장번호마다 1행,
//    대부계약에 없는 대장번호가 대부분, 기타사항 칸에 줄바꿈, 합계 행 없음
//
// 사용법
//   npm run sample-data                       기본: 대부계약 1,000건 → sample-data/
//   npm run sample-data -- --rows 100000      성능 시험용 10만 건 → sample-data/large-100000/
//   npm run sample-data -- --rows 1000000 --formats csv   100만 건, CSV만
//   옵션: --rows 건수(200~1000000)  --out 폴더  --formats xlsx,csv,txt (쉼표로 구분)

import fs from "node:fs";
import path from "node:path";
import iconv from "iconv-lite";
import * as XLSX from "xlsx";

// ─────────────────────────────────────────────────────────────
// 1. 옵션 읽기
// ─────────────────────────────────────────────────────────────
function readOption(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const LEASE_COUNT = Number(readOption("rows", "1000"));
if (!Number.isInteger(LEASE_COUNT) || LEASE_COUNT < 200 || LEASE_COUNT > 1000000) {
  console.error("--rows는 200 이상 1000000 이하의 정수여야 합니다.");
  process.exit(1);
}
const IS_LARGE = LEASE_COUNT >= 50000;
const OUT_DIR = path.resolve(
  readOption("out", IS_LARGE ? `sample-data/large-${LEASE_COUNT}` : "sample-data"),
);
const FORMATS = new Set(readOption("formats", "xlsx,csv,txt").split(","));
if (LEASE_COUNT >= 200000 && FORMATS.has("xlsx")) {
  console.warn(
    "주의: 20만 건 이상을 엑셀로 만들면 메모리를 많이 씁니다. 멈추면 --formats csv 로 다시 실행하세요.",
  );
}

// ─────────────────────────────────────────────────────────────
// 2. 고정 난수 (항상 같은 결과)
// ─────────────────────────────────────────────────────────────
function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261112);
const randInt = (n) => Math.floor(rand() * n);
const pick = (list) => list[randInt(list.length)];
function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}
// [값, 가중치] 목록에서 가중치에 따라 하나를 고른다
function weighted(pairs) {
  const total = pairs.reduce((sum, [, w]) => sum + w, 0);
  let r = rand() * total;
  for (const [value, w] of pairs) {
    r -= w;
    if (r < 0) return value;
  }
  return pairs[pairs.length - 1][0];
}

// ─────────────────────────────────────────────────────────────
// 3. 실제 보고서 모양 (사용자가 준 샘플 파일 기준)
// ─────────────────────────────────────────────────────────────
const LEASE_SHEET = "기준일자별(명세)";
const LEASE_FILTER_ROWS = [
  ["필터 차원", "조건 값"],
  ["기준일자", '"20261108"'],
  ["담당부서", '"가상지역본부"'],
  ["담당팀", "전체"],
  ["담당사원", "전체"],
  ["회계구분", '"일반"'],
  ["취득구분", "전체"],
  ["대부구분", "전체"],
  ["소재지", "전체"],
  ["대표대장여부", '"Y"'],
  ["기초생활수급여부", "전체"],
  ["만료포함여부", "전체"],
  ["고객번호", "전체"],
];
const LEASE_HEADER = [
  "순번", "대장번호", "소재지", "공부지목", "대장면적", "대장가격", "상세용도", "대부료율(%)",
  "고객번호", "고객구분", "피대부자", "기초생활수급자여부", "대부목적", "계약일자", "계약시작일자",
  "계약만기일자", "부서", "팀", "담당자",
];
const CUSTOMER_NAME_COLUMN = LEASE_HEADER.indexOf("피대부자");

const SURVEY_SHEET = "명세";
const SURVEY_FILTER_ROWS = [
  ["필터 차원", "조건 값"],
  ["기준일자", '"202610"'],
  ["담당부서", '"가상지역본부"'],
  ["회차구분", '"1"'],
];
const SURVEY_HEADER = [
  "정렬순번", "대장번호", "수탁일자", "취득구분", "재산구분", "공부지목", "현황지목", "대장면적",
  "대장가격", "조사구분", "실태조사일자", "실태조사번호", "이용현황", "주변현황", "기타사항",
];

// ─────────────────────────────────────────────────────────────
// 4. 값의 종류 (실제 샘플 파일에서 본 값과 비율, 가중치는 실제 건수)
// ─────────────────────────────────────────────────────────────
// 대부계약 대부목적에 적히는 글자 (분류별). checkset.ts의 바꿔 읽기 표가 이 글자들을 5분류로 맞춘다
const PURPOSE_BANK = {
  농업용: [["전", 1299], ["경작용", 614], ["답", 394], ["농경지", 61], ["경작", 32], ["과수원", 19], ["경작용(전)", 7], ["경작용지", 7]],
  주거용: [["주택부지", 7214], ["주거용", 821], ["주거용-주거용건물", 47], ["주거용건물", 42], ["주거용-단독주택", 17], ["단독주택", 16], ["주거용-아파트", 16], ["공동주택", 9], ["주택부지용", 6], ["주택용지", 5]],
  상업용: [["상가부지", 786], ["상업용", 16], ["판매용-근린생활시설", 6], ["점포상가", 5], ["상가부지(해물판매장)", 5]],
  종교용지: [["종교용지", 107]],
  기타: [["공장용지", 331], ["주차장용지", 231], ["잡종지", 225], ["창고용지", 146], ["도로", 145], ["특수용지", 69], ["도시가스 배관매설", 47], ["학교용지", 45], ["도시가스관 매설", 36], ["도시가스배관 매설", 32], ["주차장", 31], ["공원용지", 30], ["체육용지", 29], ["도시가스 배관 매설", 23], ["공장부지", 21], ["도로(시장 비가리개)", 14], ["가스관 매설", 12], ["수도용지", 12], ["묘지", 8], ["기타", 5]],
};
// 실제 샘플에서 5분류로 맞추기 애매한 대부목적 (표에 없어 "검토 필요"가 되어야 함). 빈 칸도 있다
const UNMAPPED_PURPOSES = [["대지", 168], ["토지", 107], ["목장용지", 19], ["임야", 6], ["", 9]];
// 분류별 대부계약 건수 비율 (실제 샘플: 주거용 59%, 농업용 17%, 기타 17%, 상업용 6%, 종교용지 1%)
const CATEGORY_WEIGHTS = [["주거용", 59], ["농업용", 17], ["기타", 17], ["상업용", 6], ["종교용지", 1]];

// 상세용도: 실제로는 46가지 정해진 값. 분류에 어울리는 값을 고른다
const DETAIL_BANK = {
  농업용: [["전", 60], ["답", 30], ["과수원", 5], ["목장용지", 3], ["임야", 2]],
  주거용: [["주택부지", 85], ["주거용-주거용건물", 8], ["주거용-단독주택", 4], ["주거용-아파트", 2], ["주거용-공동주택", 1]],
  상업용: [["상가부지", 85], ["판매용-근린생활시설", 8], ["판매용-점포상가", 4], ["판매용-일반음식점", 3]],
  종교용지: [["종교용지", 100]],
  기타: [["공장용지", 25], ["주차장용지", 20], ["도로", 20], ["잡종지", 15], ["창고용지", 10], ["학교용지", 5], ["공원용지", 5]],
};
const LAND_CATEGORY_BANK = [["대", 6802], ["도로", 1584], ["전", 1346], ["임야", 1129], ["답", 1074], ["잡종지", 865], ["구거", 495], ["하천", 202], ["제방", 82], ["철도용지", 77], ["묘지", 63], ["공장용지", 52], ["유지", 31], ["과수원", 20], ["학교용지", 18]];
const CUSTOMER_TYPE_BANK = [["개인신규", 12208], ["법인", 1205], ["지자체", 279], ["기타단체", 204], ["공공기관", 32], ["외국인", 18]];
const ACQUIRE_BANK = [["소관청내인수", 41500], ["용도폐지인수(총괄청이관)", 5476], ["사용종료(인수)", 1378], ["미등록재산등록", 748], ["누락재산등록", 327], ["국세물납", 275], ["국가귀속", 198]];
const SURVEY_KIND_BANK = [["항공영상", 24501], ["방문실태", 13339], ["방문실태(회전익)", 10688], ["모바일실태", 1721]];

// 이용현황 문장 (판정에 쓰이는 문장). 실제 샘플의 말투를 따랐다.
// 가설 건축물 낱말(컨테이너·가건물·비닐하우스·농막·가설건축물 등)은 일부러 뺐다.
const USAGE_BANK = {
  농업용: ["농경지로 이용중임", "농경지로 대부중임", "대부자가 농경지로 유상대부중임", "텃밭으로 이용중임", "경작중임", "과수원으로 이용중임", "벼 재배 중", "밭작물(고추, 깨) 재배 중"],
  주거용: ["주택부지로 이용중임", "주택부지로 대부 이용중임", "주택부지로 이용 중임", "주택부지로 대부중임", "현황 주택부지임", "대부 주택에서 거주 중"],
  상업용: ["상가부지로 이용중임", "상가로 사용하며 영업 중", "음식점 영업 중", "카페로 영업 중", "점포로 이용중임"],
  종교용지: ["교회 부지로 이용중임", "사찰 경내지로 이용중임", "종교시설 부지로 이용 중임"],
  기타: ["도로로 이용중임", "현황 도로임", "잡종지 상태의 토지임", "자연림 상태의 임야임", "공원 부지로 개방하여 사용", "마을 공용 쉼터로 사용 중", "주차장으로 이용중임"],
};
// 부적정 사례용: 대부목적과 다른 용도로 쓰고 있다는 문장 (키 = 문장이 나타내는 용도)
const VIOLATION_BANK = {
  상업용: ["무단으로 음식점을 차려 영업 중", "카페를 지어 영업 중", "상가 건물을 지어 임대 영업 중"],
  주거용: ["주택을 지어 거주 중", "무단으로 주택을 신축하여 가족이 거주 중", "주택부지로 무단점유중임"],
  종교용지: ["예배당을 지어 종교시설로 사용 중"],
  기타: ["창고 용도로 전용하여 물품 보관 중", "주차장으로 전용하여 영업 중"],
  농업용: ["농경지로 무단 경작중임"],
};
// 가설 건축물 낱말이 들어 있는 덧붙임 문구 (검토 필요가 되어야 함)
const TEMP_SUFFIX = ["컨테이너 1동 설치", "무단 가건물 설치", "비닐하우스 동 설치", "농막 설치", "콘테이너 박스 설치", "가설건축물 설치"];
// AI가 애매하다고 답해야 하는 문장 (정답은 AI 판단에 달려 있음)
const AMBIGUOUS_USAGE = ["현장 확인 불가", "출입 제한으로 확인하지 못함", "조사 중 (판단 보류)", "이용 현황 불분명"];
// 대부계약과 짝이 없는 대장번호의 실태조사에 적히는 문장 (판정에 쓰이지 않음).
// 실제 샘플처럼 도로·임야가 많고, 여러 용도가 섞인 문장과 "합계"·"소계" 낱말이 든 긴 문장도 있다
const GENERIC_USAGE = [
  ["도로로 이용중임", 30], ["현황 도로임", 28], ["도로", 8], ["도로로 이용중인 토지임", 7], ["도로임", 6], ["불특정다수가 사용하는 도로임", 5], ["골목길로 이용중임", 3],
  ["현황 잡종지임", 5], ["잡종지 상태의 토지임", 4], ["현황 임야임", 4], ["자연림 상태의 임야임", 3], ["임야임", 3], ["현황 공지임", 2],
  ["주택부지로 이용중임", 6], ["현황 주택부지임", 3], ["농경지로 이용중임", 3], ["상가부지로 이용중임", 2],
  ["일부 주택부지로 이용중이며 그 외 도로임", 3], ["도로 및 잡종지 상태의 토지임", 3], ["국지분 등 현황 도로임", 2],
  ["합계 면적 중 일부가 도로로 이용중임", 1], ["소계 면적을 기준으로 현황을 확인함", 1],
];
const NEARBY_BANK = ["주택밀집지역으로 가상초등학교, 가상구청 등이 소재", "주택 및 상가 혼재지역(가상역, 가상호텔 등 소재)", "임야지역임", "가상천 인근 농경지 지역임"];
const NOTE_BANK = [
  "- 제2종일반주거지역\n- 가축사육제한구역, 상대보호구역",
  "제2종일반주거지역\n가축사육제한구역, 상대보호구역, 중점경관관리구역",
  "- 공익용산지, 도립공원\n<추가기재> 현황 사진 첨부",
  "- 소하천구역(저촉)\n- 가축사육제한구역",
];
const SURNAMES = ["김", "이", "박", "최", "정", "강", "조", "윤"];
const GIVEN = ["가상", "시험", "샘플", "예시", "연습", "임시"];
const GIVEN_END = ["일", "이", "삼", "사", "오", "육"];
const DONGS = ["가상", "시험", "샘플", "예시", "연습"];

// ─────────────────────────────────────────────────────────────
// 5. 일부러 넣는 사례 (대부계약 1,000건 기준, 건수가 달라지면 같은 비율로 늘고 준다)
// ─────────────────────────────────────────────────────────────
// 기대 점검결과는 DESIGN §3.3 판정표를 따른다. 사례마다 대장번호 하나를 따로 쓴다(한 행짜리 대장번호).
const CASE_PLAN = [
  ["BLANK_LEDGER", 5, "대장번호 빈칸", "대조 불가"],
  ["NO_SURVEY", 30, "실태조사 없음", "대조 불가"],
  ["EMPTY_USAGE", 30, "이용현황 빈칸", "대조 불가"],
  ["UNMAPPED_PURPOSE", 20, "대부목적이 표에 없음(대지·토지 등)", "검토 필요"],
  ["TEMP_STRUCTURE", 30, "가설 건축물 낱말", "검토 필요"],
  ["AMBIGUOUS", 20, "애매한 이용현황 (AI 판단에 따라 달라질 수 있음)", "검토 필요"],
  ["VIOLATION_PLAIN", 70, "부적정 (한 건)", "부적정"],
  ["VIOLATION_LATEST", 20, "부적정 (예전엔 정상, 최근 조사만 부적정)", "부적정"],
  ["VIOLATION_SAME_DATE", 10, "부적정 (같은 날짜 두 건 중 아래 행이 부적정)", "부적정"],
  ["OLD_VIOLATION", 30, "정상 (예전엔 부적정, 최근 조사는 정상)", "정상"],
  ["UNREADABLE_DATE", 10, "정상 (날짜를 못 읽는 행은 가장 오래된 것으로 봄)", "정상"],
  ["NAME_IN_SENTENCE", 30, "정상 (이용현황에 고객명이 들어 있음)", "정상"],
  ["PHONE_IN_SENTENCE", 10, "정상 (이용현황에 전화번호·주민번호 모양이 들어 있음)", "정상"],
];
const planned = CASE_PLAN.map(([type, per1000, label, expected]) => ({
  type,
  count: Math.max(1, Math.round((LEASE_COUNT * per1000) / 1000)),
  label,
  expected,
}));
const specialTotal = planned.reduce((sum, p) => sum + p.count, 0);
if (specialTotal > LEASE_COUNT * 0.6) {
  console.error("사례가 너무 많습니다. --rows를 늘려 주세요.");
  process.exit(1);
}
const blankCount = planned.find((p) => p.type === "BLANK_LEDGER").count;

// ─────────────────────────────────────────────────────────────
// 6. 날짜·번호 도우미
// ─────────────────────────────────────────────────────────────
const pad2 = (n) => String(n).padStart(2, "0");
const isoText = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const compactText = (d) => isoText(d).replaceAll("-", "");
function randomDate(from, to) {
  const span = Math.floor((to.getTime() - from.getTime()) / 86400000);
  const d = new Date(from.getTime());
  d.setDate(d.getDate() + randInt(span + 1));
  return d;
}
function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}
const latestDate = () => randomDate(new Date(2025, 0, 1), new Date(2026, 9, 31));

// 실태조사일자 칸에 적는 모양. 실제는 거의 "20260323" 같은 글자, 가끔 빈 칸이다.
// 나머지 모양은 읽기 규칙(DESIGN §3.4)을 시험하려고 조금 섞는다.
function dateCell(date, kind) {
  switch (kind) {
    case "compact": return compactText(date);
    case "excel": return date; // 엑셀 날짜 칸
    case "iso": return isoText(date);
    case "dot": return isoText(date).replaceAll("-", ".");
    case "slash": return isoText(date).replaceAll("-", "/");
    case "blank": return "";
    default: return "날짜미상";
  }
}
const readableKind = () => weighted([["compact", 91], ["excel", 5], ["iso", 2], ["dot", 1], ["slash", 1]]);
const anyKind = () => weighted([["compact", 90], ["excel", 4], ["iso", 2], ["dot", 1], ["slash", 1], ["blank", 2]]);

// ─────────────────────────────────────────────────────────────
// 7. 대장번호(ledger)와 대부계약 행 만들기
// ─────────────────────────────────────────────────────────────
// 대장번호 하나에 실태조사가 있고, 대부계약은 같은 대장번호에 여러 행(계약)이 있을 수 있다.
const ledgers = []; // { id, address, landCategory, area, price, category, caseType, surveys:[], leaseRows:[] }

function makeLedger(caseType) {
  const area = rand() < 0.1 ? Number((3 + rand() * 60).toFixed(2)) : 1 + randInt(400);
  const ledger = {
    id: "", // 나중에 번호를 붙인다
    address: `가상광역시 가상구 ${pick(DONGS)}동  ${1 + randInt(900)}-${1 + randInt(120)}`,
    landCategory: weighted(LAND_CATEGORY_BANK),
    area,
    price: Math.round(area * (200000 + randInt(1800000))),
    category: weighted(CATEGORY_WEIGHTS),
    caseType,
    surveys: [], // { date, kind, usage, usageCat, temp }
    leaseRows: [],
  };
  ledgers.push(ledger);
  return ledger;
}

function makeLeaseRow(ledger, { unmapped = false } = {}) {
  const category = ledger.category;
  const purposeText = unmapped ? weighted(UNMAPPED_PURPOSES) : weighted(PURPOSE_BANK[category]);
  const start = randomDate(new Date(2018, 0, 1), new Date(2026, 8, 30));
  const end = addDays(new Date(start.getFullYear() + 5, start.getMonth(), start.getDate()), -1);
  const row = {
    ledger,
    customerNo: String(randInt(1000000)).padStart(7, "0"),
    customerType: weighted(CUSTOMER_TYPE_BANK),
    customerName: `${pick(SURNAMES)}${pick(GIVEN)}${pick(GIVEN_END)}`,
    welfare: rand() < 0.07 ? "Y" : "N",
    rate: pick([1, 2, 2, 2, 2, 3, 3.5, 5, 7]),
    purposeText,
    purposeCategory: unmapped ? null : category, // null이면 대부목적을 5분류로 맞출 수 없음
    detail: weighted(DETAIL_BANK[category]),
    contractDate: compactText(rand() < 0.8 ? start : addDays(start, -randInt(60))),
    startDate: compactText(start),
    endDate: compactText(end),
    caseType: ledger?.caseType ?? "NORMAL",
  };
  ledger?.leaseRows.push(row);
  return row;
}

// 사례별 대장번호와 대부계약 행 (사례 하나가 대장번호 하나, 행 하나)
const caseLedgers = {}; // 사례 종류 → 대장번호 목록
for (const p of planned) {
  caseLedgers[p.type] = [];
  for (let i = 0; i < p.count; i++) {
    if (p.type === "BLANK_LEDGER") {
      // 대장번호 칸이 빈 행: 대장번호 없이 대부계약 행만 있다
      const phantom = {
        id: "", address: "", landCategory: "", area: 0, price: 0, category: weighted(CATEGORY_WEIGHTS),
        caseType: p.type, surveys: [], leaseRows: [],
      };
      const row = makeLeaseRow(phantom);
      row.ledger = phantom;
      caseLedgers[p.type].push(phantom);
      continue;
    }
    const ledger = makeLedger(p.type);
    makeLeaseRow(ledger, { unmapped: p.type === "UNMAPPED_PURPOSE" });
    caseLedgers[p.type].push(ledger);
  }
}

// 보통 대장번호: 대부계약 행 수는 LEASE_COUNT가 되도록, 대장번호 수는 실제 비율(행 대비 약 74%)에 가깝게
const normalRowCount = LEASE_COUNT - specialTotal;
const targetLedgers = Math.round(LEASE_COUNT * 0.736);
const normalLedgerCount = Math.min(
  normalRowCount,
  Math.max(1, targetLedgers - (specialTotal - blankCount)),
);
const normalLedgers = [];
for (let i = 0; i < normalLedgerCount; i++) {
  const ledger = makeLedger("NORMAL");
  makeLeaseRow(ledger);
  normalLedgers.push(ledger);
}
for (let i = normalLedgerCount; i < normalRowCount; i++) {
  // 남은 계약은 일부 대장번호에 몰아서 붙인다 (같은 대장번호에 계약이 여러 건)
  const ledger = normalLedgers[Math.floor(Math.pow(rand(), 2) * normalLedgers.length)];
  makeLeaseRow(ledger);
}
// 같은 대장번호의 계약들은 같은 분류의 대부목적을 쓴다 (분류가 다르면 정답이 계약마다 달라져서)

// ─────────────────────────────────────────────────────────────
// 8. 대장번호 정하고 실태조사 만들기
// ─────────────────────────────────────────────────────────────
const normalSentence = (cat) => pick(USAGE_BANK[cat]);
function violationSentence(cat) {
  const others = Object.keys(VIOLATION_BANK).filter((c) => c !== cat);
  const usageCat = pick(others);
  return { usage: pick(VIOLATION_BANK[usageCat]), usageCat };
}
const survey = (ledger, date, kind, usage, usageCat, temp = false) =>
  ledger.surveys.push({ date, kind, usage, usageCat, temp });

for (const ledger of ledgers) {
  const latest = latestDate();
  const older = addDays(latest, -(30 + randInt(770)));
  const cat = ledger.category;
  const normal = () => ({ usage: normalSentence(cat), usageCat: cat });
  const s = (date, kind, v, temp = false) => survey(ledger, date, kind, v.usage, v.usageCat, temp);

  switch (ledger.caseType) {
    case "NO_SURVEY":
      break;
    case "EMPTY_USAGE":
      if (rand() < 0.5) s(older, readableKind(), normal());
      s(latest, readableKind(), { usage: rand() < 0.5 ? "" : "   ", usageCat: "" });
      break;
    case "UNMAPPED_PURPOSE":
      s(latest, readableKind(), normal());
      break;
    case "TEMP_STRUCTURE": {
      const n = normal();
      s(latest, readableKind(), { usage: `${n.usage}, ${pick(TEMP_SUFFIX)}`, usageCat: n.usageCat }, true);
      break;
    }
    case "AMBIGUOUS":
      s(latest, readableKind(), { usage: pick(AMBIGUOUS_USAGE), usageCat: "ambiguous" });
      break;
    case "VIOLATION_PLAIN":
      s(latest, readableKind(), violationSentence(cat));
      break;
    case "VIOLATION_LATEST":
      s(older, readableKind(), normal());
      s(latest, readableKind(), violationSentence(cat));
      break;
    case "VIOLATION_SAME_DATE": {
      const kind = readableKind();
      s(latest, kind, normal()); // 위 행: 정상
      s(latest, kind, violationSentence(cat)); // 아래 행: 부적정 (이 행을 써야 함)
      break;
    }
    case "OLD_VIOLATION":
      s(older, readableKind(), violationSentence(cat));
      s(latest, readableKind(), normal());
      break;
    case "UNREADABLE_DATE":
      s(older, "unreadable", violationSentence(cat)); // 날짜를 못 읽는 행
      s(latest, readableKind(), normal());
      break;
    case "NAME_IN_SENTENCE": {
      const n = normal();
      s(latest, readableKind(), { usage: `${n.usage} (조사 입회: ${ledger.leaseRows[0].customerName})`, usageCat: n.usageCat });
      break;
    }
    case "PHONE_IN_SENTENCE": {
      const n = normal();
      s(latest, readableKind(), { usage: `${n.usage} (${pick(["연락처 010-1234-5678", "신분 확인 800101-1234567"])})`, usageCat: n.usageCat });
      break;
    }
    default: {
      // 보통 대장번호: 대부분 한 건(실제 파일도 대장번호마다 1행), 가끔 두 건(둘 다 정상 문장)
      if (rand() < 0.08) {
        s(older, readableKind(), normal());
        s(latest, readableKind(), normal());
      } else {
        s(latest, anyKind(), normal());
      }
    }
  }
}

// 대부계약과 짝이 없는 대장번호의 실태조사 (실제 샘플은 실태조사의 약 80%가 이런 대장번호)
const matchedSurveyRows = ledgers.reduce((sum, l) => sum + l.surveys.length, 0);
const surveyTarget = Math.min(Math.round(ledgers.length * 4.9), 1000000);
const minUnmatched = Math.max(10, Math.round(LEASE_COUNT * 0.03));
const unmatchedCount = Math.max(minUnmatched, Math.min(surveyTarget, 1000000) - matchedSurveyRows);
const unmatchedLedgers = [];
for (let i = 0; i < unmatchedCount && matchedSurveyRows + i < 1000000; i++) {
  const usage = weighted(GENERIC_USAGE);
  const ledger = {
    id: "", address: "", landCategory: weighted(LAND_CATEGORY_BANK),
    area: 1 + randInt(2000), price: 0, category: "", caseType: "UNMATCHED",
    surveys: [{ date: latestDate(), kind: anyKind(), usage, usageCat: "", temp: false }],
    leaseRows: [],
  };
  ledger.price = ledger.area * (100000 + randInt(900000));
  unmatchedLedgers.push(ledger);
}

// 대장번호 붙이기: 실제처럼 "8자리 + 영문 1자 + 9자리" (18자), 순서대로 늘어나는 번호를 섞어서 나눠 준다
const allLedgers = [...ledgers, ...unmatchedLedgers];
{
  const total = allLedgers.length;
  const prefixes = ["99000001", "99000002", "99000003", "99000004", "99000005", "99000006"];
  const sortedIds = [];
  let serial = 1000 + randInt(5000);
  for (let i = 0; i < total; i++) {
    serial += 1 + randInt(40);
    const prefix = prefixes[Math.min(prefixes.length - 1, Math.floor((i / total) * prefixes.length))];
    sortedIds.push(`${prefix}A${String(serial).padStart(9, "0")}`);
  }
  const order = shuffle([...Array(total).keys()]);
  allLedgers.forEach((ledger, i) => (ledger.id = sortedIds[order[i]]));
}
const byLedgerId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// ─────────────────────────────────────────────────────────────
// 9. 기대 점검결과 (DESIGN §3.3 판정표 순서대로, AI 분류는 문장을 만들 때 정해 둔 분류를 쓴다)
// ─────────────────────────────────────────────────────────────
function timeOf(s) {
  if (s.kind === "unreadable" || s.kind === "blank") return -Infinity; // 못 읽는 날짜는 가장 오래된 것으로 본다
  return s.date.getTime();
}
function expectedResult(row) {
  const ledger = row.ledger;
  if (ledger.id === "") return "대조 불가"; // 1. 대장번호 빈칸
  if (ledger.surveys.length === 0) return "대조 불가"; // 2. 실태조사 없음
  // 가장 최근 1건 (날짜가 같으면 파일에서 더 아래에 있는 행)
  let latest = ledger.surveys[0];
  for (const s of ledger.surveys) if (timeOf(s) >= timeOf(latest)) latest = s;
  if (latest.usage.trim() === "") return "대조 불가"; // 3. 이용현황 빈칸
  if (row.purposeCategory === null) return "검토 필요"; // 4. 대부목적 분류 불가
  if (latest.temp) return "검토 필요"; // 5. 가설 건축물 낱말
  if (latest.usageCat === "ambiguous") return "검토 필요"; // 6. AI가 판단 불가
  return latest.usageCat === row.purposeCategory ? "정상" : "부적정"; // 7·8
}

// ─────────────────────────────────────────────────────────────
// 10. 파일 내용(행 목록) 만들기
// ─────────────────────────────────────────────────────────────
// 대부계약: 같은 대장번호의 행이 이어지도록 대장번호 순으로 놓고, 대장번호 빈 행은 무작위 자리에 끼운다
const leaseOrder = ledgers.filter((l) => l.id !== "").sort(byLedgerId).flatMap((l) => l.leaseRows);
for (const phantom of caseLedgers.BLANK_LEDGER) {
  leaseOrder.splice(randInt(leaseOrder.length + 1), 0, ...phantom.leaseRows);
}
leaseOrder.forEach((row, i) => (row.seq = i + 1));

function leaseSheetRows(withCustomer) {
  const drop = (cells) => (withCustomer ? cells : cells.filter((_, i) => i !== CUSTOMER_NAME_COLUMN));
  const rows = [...LEASE_FILTER_ROWS, drop(LEASE_HEADER)];
  for (const r of leaseOrder) {
    const l = r.ledger;
    rows.push(drop([
      r.seq, l.id, l.address, l.landCategory, l.area, l.price, r.detail, r.rate, r.customerNo,
      r.customerType, r.customerName, r.welfare, r.purposeText, r.contractDate, r.startDate, r.endDate,
      "", "", "",
    ]));
  }
  return rows;
}

// 같은 대장번호가 파일마다 조금 다르게 적히는 일이 있다 (공백·하이픈 차이)
function ledgerVariant(id) {
  const r = rand();
  if (r < 0.96) return id;
  if (r < 0.975) return `${id} `;
  if (r < 0.99) return `${id.slice(0, 8)} ${id.slice(8)}`;
  return `${id.slice(0, 8)}-${id.slice(8)}`;
}
function landCategoryOfUsage(usageCat) {
  if (usageCat === "농업용") return pick(["전", "답", "과수원"]);
  if (usageCat === "주거용" || usageCat === "상업용") return "대";
  if (usageCat === "종교용지") return "종교용지";
  if (usageCat === "기타") return pick(["도로", "잡종지", "임야", "주차장", "공원"]);
  return "확인불가";
}

// 실태조사: 대장번호 순으로 놓는다 (같은 날짜 두 건은 원래 순서 위→아래를 지킨다)
const surveyLedgers = allLedgers.filter((l) => l.surveys.length > 0).sort(byLedgerId);
let surveySeq = 0;
let researchNo = 0;
function surveySheetRows() {
  const rows = [...SURVEY_FILTER_ROWS, SURVEY_HEADER];
  for (const l of surveyLedgers) {
    for (const s of l.surveys) {
      researchNo += 1 + randInt(30);
      const date = s.kind === "unreadable" || s.kind === "blank" ? null : s.date;
      rows.push([
        ++surveySeq,
        ledgerVariant(l.id),
        compactText(randomDate(new Date(2005, 0, 1), new Date(2023, 11, 31))),
        weighted(ACQUIRE_BANK),
        rand() < 0.997 ? "토지" : "건물",
        l.landCategory,
        landCategoryOfUsage(s.usageCat),
        l.area,
        l.price,
        rand() < 0.0006 ? "" : weighted(SURVEY_KIND_BANK),
        dateCell(s.date, s.kind),
        `${date ? compactText(date).slice(0, 6) : "202601"}${String(researchNo).padStart(7, "0")}`,
        s.usage,
        rand() < 0.018 ? "" : pick(NEARBY_BANK),
        rand() < 0.035 ? "" : pick(NOTE_BANK),
      ]);
    }
  }
  return rows;
}

const leaseTable = leaseSheetRows(true);
const surveyTable = surveySheetRows();

// ─────────────────────────────────────────────────────────────
// 11. 파일로 쓰기
// ─────────────────────────────────────────────────────────────
fs.mkdirSync(OUT_DIR, { recursive: true });
const written = [];
function save(name, data) {
  fs.writeFileSync(path.join(OUT_DIR, name), data);
  written.push(name);
}

// 엑셀: 시트 하나(실제 파일처럼). 엑셀 날짜 칸은 yyyy-mm-dd 표시 형식을 붙인다
function workbookOf(rows, sheetName) {
  const sheet = XLSX.utils.aoa_to_sheet(rows, { cellDates: true });
  for (const cell of Object.values(sheet)) {
    if (cell && typeof cell === "object" && cell.t === "d") cell.z = "yyyy-mm-dd";
  }
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, sheetName);
  return book;
}
const xlsxBuffer = (rows, sheetName, bookType) =>
  XLSX.write(workbookOf(rows, sheetName), { type: "buffer", bookType, cellDates: true });

// CSV·TXT: 날짜는 글자로. 구분 기호·따옴표·줄바꿈이 있으면 따옴표로 감싼다
function cellText(value) {
  if (value instanceof Date) return isoText(value);
  return value === undefined || value === null ? "" : String(value);
}
function delimited(rows, delimiter) {
  let width = 0;
  for (const r of rows) if (r.length > width) width = r.length; // Math.max(...)는 행이 많으면 오류가 난다
  const needsQuote = new RegExp(`["\\r\\n${delimiter === "\t" ? "\\t" : delimiter}]`);
  return rows
    .map((row) =>
      Array.from({ length: width }, (_, i) => {
        const c = cellText(row[i]);
        return needsQuote.test(c) ? `"${c.replaceAll('"', '""')}"` : c;
      }).join(delimiter),
    )
    .join("\r\n");
}

if (FORMATS.has("xlsx")) {
  save("lease.xlsx", xlsxBuffer(leaseTable, LEASE_SHEET, "xlsx"));
  save("survey.xlsx", xlsxBuffer(surveyTable, SURVEY_SHEET, "xlsx"));
  if (!IS_LARGE) {
    save("lease-nocustomer.xlsx", xlsxBuffer(leaseSheetRows(false), LEASE_SHEET, "xlsx"));
    save("survey.xls", xlsxBuffer(surveyTable, SURVEY_SHEET, "biff8")); // 예전 .xls 형식
  }
}
if (FORMATS.has("csv")) {
  // 대부계약: EUC-KR (공공기관 시스템에서 내려받은 파일처럼)
  save("lease-euckr.csv", iconv.encode(delimited(leaseTable, ","), "euc-kr"));
  // 실태조사: UTF-8 + BOM (엑셀에서 저장한 CSV처럼)
  save("survey-utf8bom.csv", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(delimited(surveyTable, ","), "utf8")]));
}
if (FORMATS.has("txt")) {
  // 탭으로 나눈 텍스트 (UTF-8)
  save("survey-tab.txt", Buffer.from(delimited(surveyTable, "\t"), "utf8"));
  if (!IS_LARGE) save("lease-tab.txt", Buffer.from(delimited(leaseTable, "\t"), "utf8"));
}

// 정답지: 대부계약 행마다 사례 종류와 기대 점검결과 (탐지율 SC-3 확인용)
const normalizeId = (text) => text.replace(/[\s-]/g, "");
const keyRows = [["순번", "대장번호(대부계약 파일 표기)", "정리된 대장번호", "사례 종류", "기대 점검결과", "설명"]];
const labelOf = Object.fromEntries(planned.map((p) => [p.type, p.label]));
const expectedCounts = {};
for (const r of leaseOrder) {
  const expected = expectedResult(r);
  r.expected = expected;
  expectedCounts[expected] = (expectedCounts[expected] ?? 0) + 1;
  keyRows.push([
    r.seq, r.ledger.id, normalizeId(r.ledger.id), r.ledger.caseType, expected,
    labelOf[r.ledger.caseType] ?? "정상 (대부목적과 이용현황이 같은 분류)",
  ]);
}
save(
  "answer-key.csv",
  Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(delimited(keyRows, ","), "utf8")]),
);

// ─────────────────────────────────────────────────────────────
// 12. 요약과 안내 문서
// ─────────────────────────────────────────────────────────────
const violationRows = leaseOrder.filter((r) => r.expected === "부적정").length;
const surveyDataCount = surveyTable.length - SURVEY_FILTER_ROWS.length - 1;
const sharedLedgers = ledgers.filter((l) => l.leaseRows.length > 1).length;
const usedLedgerCount = ledgers.filter((l) => l.id !== "").length;
const emptyUsageSurveys = surveyLedgers.reduce((n, l) => n + l.surveys.filter((s) => !s.usage.trim()).length, 0);

const summaryLines = [
  `대부계약 현황: ${LEASE_COUNT.toLocaleString()}건, 서로 다른 대장번호 ${usedLedgerCount.toLocaleString()}개 (같은 대장번호에 계약이 둘 이상인 대장번호 ${sharedLedgers.toLocaleString()}개)`,
  `실태조사 내역: ${surveyDataCount.toLocaleString()}건`,
  `그중 대부계약에 없는 대장번호의 실태조사: ${unmatchedLedgers.length.toLocaleString()}건 (짝이 없어 쓰이지 않아야 함)`,
  `일부러 넣은 부적정 사례: ${violationRows}건`,
  `기대 점검결과: ${Object.entries(expectedCounts).map(([k, v]) => `${k} ${v}`).join(" / ")}`,
  `빈 이용현황 행: ${emptyUsageSurveys}건`,
];

const readme = `# 가상 시험 데이터

> \`npm run sample-data\`로 만든 **가상** 데이터입니다. 이름·번호·주소는 모두 지어낸 값이며 실제 감사 자료가 아닙니다.
> 같은 명령을 다시 실행하면 항상 같은 파일이 만들어집니다. (계획 작업 3 / 설계 §9.5)
>
> **모양은 \`data/\` 폴더의 실제 형식 샘플(개인정보를 지운 파일)을 따랐습니다.** 열 이름·열 순서·시트 이름·
> 맨 위 "필터 차원" 표·날짜가 글자(\`20250101\`)인 점·같은 대장번호에 계약이 여러 건인 점이 같습니다.
> 값의 종류(대부목적·상세용도·이용현황 문장)도 실제 샘플에서 본 것을 골랐습니다.

## 규모

${summaryLines.map((line) => `- ${line}`).join("\n")}

## 파일

| 파일 | 내용 |
|---|---|
| \`lease.xlsx\` | 대부계약 현황. 시트 "${LEASE_SHEET}", 맨 위 ${LEASE_FILTER_ROWS.length}줄은 필터 표, ${LEASE_FILTER_ROWS.length + 1}번째 줄이 제목 줄(${LEASE_HEADER.length}열), 날짜는 글자 |
| \`survey.xlsx\` | 실태조사 내역. 시트 "${SURVEY_SHEET}", 맨 위 ${SURVEY_FILTER_ROWS.length}줄은 필터 표, ${SURVEY_FILTER_ROWS.length + 1}번째 줄이 제목 줄(${SURVEY_HEADER.length}열), 기타사항 칸에 줄바꿈 |
| \`lease-nocustomer.xlsx\` | 피대부자(고객 이름) 열이 없는 대부계약 현황 (이름은 못 가린다는 안내 시험용) |
| \`survey.xls\` | 예전 .xls 형식의 실태조사 내역 |
| \`lease-euckr.csv\` | 대부계약 현황, CSV, **EUC-KR** 한글 |
| \`survey-utf8bom.csv\` | 실태조사 내역, CSV, UTF-8(BOM), 줄바꿈이 든 칸은 따옴표로 감쌈 |
| \`survey-tab.txt\`, \`lease-tab.txt\` | 탭으로 나눈 텍스트 (UTF-8) |
| \`answer-key.csv\` | **정답지**: 대부계약 행마다 사례 종류와 기대 점검결과 |

## 실제 형식과 다르게 넣은 것 (시험용)

- 실제 실태조사 파일은 **대장번호마다 1행**이지만, 최근 조사 선택을 시험하려고 일부 대장번호는 2행으로 만들었습니다.
- 실제 파일에는 없지만 읽기 규칙을 시험하려고 날짜 모양(엑셀 날짜, \`2026-05-12\`, \`2026.05.12\`, \`2026/05/12\`, \`날짜미상\`)과 대장번호 표기 차이(뒤 공백, 8자리 뒤 공백·하이픈)를 조금 섞었습니다.
- 실제 파일에서 피대부자(고객 이름) 열은 비워져 있었지만, 이름 가리기를 시험하려고 가짜 이름을 채웠습니다.

## 일부러 넣은 사례 (기본 1,000건 기준)

| 사례 종류 | 건수 | 기대 점검결과 |
|---|---:|---|
${planned.map((p) => `| \`${p.type}\` ${p.label} | ${p.count} | ${p.expected} |`).join("\n")}
| 보통 건 | 나머지 | 정상 |

- **\`AMBIGUOUS\`는 AI 판단에 달려 있습니다.** "이용 현황 불분명" 같은 문장을 AI가 "판단 불가"로 답하면 검토 필요, 다른 분류로 답하면 결과가 달라질 수 있습니다.
- **같은 날짜 두 건(\`VIOLATION_SAME_DATE\`):** 같은 날짜라면 파일에서 더 아래에 있는 행을 씁니다(설계 §3.4).
- **날짜를 못 읽는 행(\`UNREADABLE_DATE\`):** 가장 오래된 것으로 보고 최근 1건 선택에서 뒤로 미룹니다.
- **\`UNMAPPED_PURPOSE\`:** 대부목적이 "대지"·"토지"·"목장용지"·"임야"·빈 칸처럼 바꿔 읽기 표에 없는 값입니다.

## 성능 시험용 큰 데이터

\`\`\`
npm run sample-data -- --rows 100000
npm run sample-data -- --rows 1000000 --formats csv
\`\`\`

큰 파일은 \`sample-data/large-건수/\` 폴더에 만들어집니다. 용량이 크니 시험이 끝나면 지우세요.
`;
save("README.md", Buffer.from(readme, "utf8"));

console.log(`\n가상 시험 데이터를 만들었습니다 → ${OUT_DIR}`);
for (const line of summaryLines) console.log(" -", line);
console.log("\n만든 파일:");
for (const name of written) console.log(" -", name);
