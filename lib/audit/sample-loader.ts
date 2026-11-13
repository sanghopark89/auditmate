// 샘플 파일(가상 데이터)을 어디서 실행하든 가져오는 기능
//
// 앱을 열어 둔 주소가 어디든(도메인, 하위 경로, 프록시 뒤, 업무망 서버) 동작하도록 후보 주소를 차례로 시도한다.
//  1) 앱과 함께 빌드된 파일의 주소 (checksets.ts의 첫 후보): 앱 스크립트가 불러와지는 곳을 그대로 따라간다.
//  2) 현재 페이지 기준 상대 주소 (samples/파일명)
//  3) 사이트 맨 위 기준 절대 주소 (/samples/파일명)
// 서버가 파일 대신 오류 화면(HTML)을 200으로 돌려주는 경우가 있어서, 받은 내용이 진짜 엑셀(zip)인지 첫 글자로 확인한다.

import type { CheckSetSample } from "./checksets";

/** xlsx는 zip 파일이라 앞 두 글자가 "PK"이다 */
function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length > 100 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

export class SampleLoadError extends Error {
  /** 시도한 주소와 실패 이유 (화면에 안내하고, 문제를 알릴 때 쓴다) */
  attempts: string[];
  constructor(fileName: string, attempts: string[]) {
    super(`샘플 파일(${fileName})을 가져오지 못했습니다. 시도한 곳: ${attempts.join(" / ")}`);
    this.name = "SampleLoadError";
    this.attempts = attempts;
  }
}

/** 샘플 하나를 File로 가져온다. 후보 주소를 앞에서부터 시도하고, 모두 실패하면 SampleLoadError */
export async function loadSampleFile(sample: CheckSetSample, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<File> {
  const attempts: string[] = [];
  for (const url of sample.urls) {
    try {
      const res = await fetchImpl(url, { cache: "no-store" });
      if (!res.ok) {
        attempts.push(`${url} → ${res.status}`);
        continue;
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (!looksLikeZip(bytes)) {
        attempts.push(`${url} → 엑셀 파일이 아닌 응답`);
        continue;
      }
      return new File([bytes], sample.fileName, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    } catch (e) {
      attempts.push(`${url} → ${e instanceof Error ? e.message : "연결 실패"}`);
    }
  }
  throw new SampleLoadError(sample.fileName, attempts);
}
