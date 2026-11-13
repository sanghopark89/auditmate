// 점검 세트 목록 — 첫 화면에서 고르는 점검 종류
//
// 지금은 "대부목적 위반 점검" 1종뿐이다. 점검 세트를 늘릴 때는 이 목록에 한 항목을 추가하고,
// 그 세트의 화면·판정 규칙을 만들어 연결한다(그 일은 PRD 6번 비범위라 사용자 결정이 있을 때만 한다).
// 이 파일은 화면과 무관한 순수 데이터라 서버·브라우저 어디서나 쓸 수 있다.

import type { Slot } from "./pipeline";

/** 샘플 파일: 칸 → 내려받을 주소 후보(public/samples). sample-loader.ts가 앞에서부터 시도한다 */
export interface CheckSetSample {
  slot: Slot;
  /** 브라우저가 가져올 주소 후보 (앞에서부터 시도) */
  urls: string[];
  /** 칸에 올린 것으로 보여줄 파일 이름 */
  fileName: string;
}

export interface CheckSetInfo {
  id: string;
  name: string;
  /** 첫 화면 카드에 적는 한 줄 설명 */
  summary: string;
  /** 필요한 파일 목록 (카드에 보여준다) */
  inputs: string[];
  /** 누르면 자동으로 넣어 주는 가상 샘플 파일 (두 보고서) */
  samples: CheckSetSample[];
  /** 누르면 대응표 칸에 자동으로 넣어 주는 샘플 대응표 (위 샘플을 AI로 분류해 만든 것) */
  mappingSample?: CheckSetSample;
}

/**
 * 샘플 주소 후보 만들기. 첫 번째는 앱과 함께 빌드된 파일의 주소(어디서 실행해도 앱 스크립트를 따라간다),
 * 이어서 현재 페이지 기준 상대 주소, 사이트 맨 위 기준 절대 주소를 시도한다.
 */
function sampleUrls(fileName: string, bundled: string): string[] {
  return [...new Set([bundled, `samples/${fileName}`, `/samples/${fileName}`])];
}

export const CHECKSETS: readonly CheckSetInfo[] = [
  {
    id: "lease-purpose",
    name: "대부목적 위반 점검",
    summary: "대부계약 현황과 실태조사 내역을 대장번호로 대조해, 실제 이용현황이 대부목적과 맞는지 점검합니다.",
    inputs: ["대부계약 현황 통계 보고서", "최근 실태조사 내역 현황 통계 보고서", "대응표 (선택)"],
    samples: [
      { slot: "lease", urls: sampleUrls("lease.xlsx", new URL("../../public/samples/lease.xlsx", import.meta.url).href), fileName: "lease.xlsx" },
      { slot: "survey", urls: sampleUrls("survey.xlsx", new URL("../../public/samples/survey.xlsx", import.meta.url).href), fileName: "survey.xlsx" },
    ],
    mappingSample: {
      slot: "mapping",
      urls: sampleUrls("mapping.xlsx", new URL("../../public/samples/mapping.xlsx", import.meta.url).href),
      fileName: "대응표_샘플.xlsx",
    },
  },
];
