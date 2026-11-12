// 계획 작업 11 / 설계 §4·§7 — 서버에서 AI를 불러 이용현황 문장을 분류한다 (서버 전용)
//
// 이 파일은 API 키(.env의 OPENAI_API_KEY)를 읽는다. 화면(브라우저) 코드에서 불러오면 빌드가 막히도록
// 맨 위에 server-only를 둔다. 키 값과 문장 내용은 로그에 남기지 않는다(설계 §7).
import "server-only";

import OpenAI from "openai";
import { UNDECIDABLE } from "../audit/checkset";
import { AI_RESPONSE_SCHEMA, buildMessages, normalizeAiAnswer } from "./classify-shared";
import type { ClassifyResultItem } from "./classify-shared";

/**
 * 분류에 쓰는 모델. 날짜가 붙은 이름으로 고정해, 모델이 몰래 바뀌어 결과가 달라지는 일을 막는다.
 * 선택 이유(가상 문장 49개 시험, 2026-11-12): gpt-5.4-mini와 gpt-5.4-nano가 모두 정확 49/49, 두 번 실행 결과도 같았고
 * gpt-4.1-mini는 48/49였다. 처음에는 mini를 골랐으나, 사용량(비용)을 줄이려고 같은 계열에서 더 작은 nano로 바꿨다(2026-11-12).
 * 10만 건 시험에서 nano는 정답지와 99.93% 일치(부적정 사례 99.28% 탐지)로 mini(100%)보다 약간 낮았다. 모두 temperature 0을 받는다.
 * 환경 변수 OPENAI_CLASSIFY_MODEL이 있으면 그 모델을 쓴다 (시험·교체용, 비밀 값 아님).
 */
export const DEFAULT_CLASSIFY_MODEL = "gpt-5.4-nano-2026-03-17";

/** AI 호출 한 번의 최대 대기 시간 (밀리초). 서버의 maxDuration(60초)보다 짧게 둔다 */
const AI_TIMEOUT_MS = 50_000;

/** API 응답으로 바꿀 수 있는 오류. status는 HTTP 상태, code는 화면·재시도 판단용 이름 */
export class ClassifyError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ClassifyError";
    this.status = status;
    this.code = code;
  }
}

/** AI 호출에서 난 오류를 API 오류로 바꾼다 (내용·키는 남기지 않고 상태 코드만 본다) */
function toClassifyError(error: unknown): ClassifyError {
  if (error instanceof ClassifyError) return error;
  const status = error instanceof OpenAI.APIError ? error.status : undefined;
  if (status === 429) {
    return new ClassifyError(429, "RATE_LIMITED", "AI 서비스 요청 한도를 넘었습니다. 잠시 기다렸다가 다시 시도합니다");
  }
  if (status === 401 || status === 403) {
    return new ClassifyError(503, "AI_AUTH_FAILED", "AI 서비스 인증에 실패했습니다. 관리자에게 알려 주세요");
  }
  if (status !== undefined && status >= 400 && status < 500) {
    return new ClassifyError(502, "AI_BAD_RESPONSE", "AI 서비스가 요청을 받아들이지 않았습니다");
  }
  return new ClassifyError(503, "AI_UNAVAILABLE", "AI 서비스에 연결하지 못했습니다");
}

/**
 * 이용현황 문장(이미 개인정보를 가린 것)을 AI로 분류한다. 요청한 문장 순서대로 결과를 돌려준다.
 *  - AI 답에서 일부 문장이 빠졌거나 분류 값이 허용 밖이면 그 문장만 "판단 불가"로 채운다.
 *  - AI 답 전체를 읽을 수 없으면 ClassifyError(502)를 던진다 (브라우저가 기다렸다가 다시 시도).
 */
export async function classifyWithAi(sentences: readonly { id: string; text: string }[]): Promise<ClassifyResultItem[]> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new ClassifyError(503, "AI_NOT_CONFIGURED", "AI 서비스 키가 설정되지 않았습니다. 관리자에게 알려 주세요");
  }
  const model = process.env.OPENAI_CLASSIFY_MODEL?.trim() || DEFAULT_CLASSIFY_MODEL;
  const client = new OpenAI({ apiKey, maxRetries: 0, timeout: AI_TIMEOUT_MS }); // 다시 시도는 브라우저가 한다

  let content: string | null | undefined;
  try {
    const completion = await client.chat.completions.create({
      model,
      messages: buildMessages(sentences),
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: { name: "classification", strict: true, schema: AI_RESPONSE_SCHEMA },
      },
    });
    content = completion.choices[0]?.message?.content;
  } catch (error) {
    const converted = toClassifyError(error);
    // 상태만 기록한다 (문장·키는 남기지 않는다)
    console.error(`[classify] AI 호출 실패: ${converted.code} (${converted.status})`);
    throw converted;
  }

  let raw: unknown = null;
  try {
    raw = content ? JSON.parse(content) : null;
  } catch {
    raw = null;
  }
  const answer = normalizeAiAnswer(
    sentences.map((s) => s.id),
    raw,
  );
  if (!answer) {
    console.error("[classify] AI 답을 읽을 수 없음 (정해진 모양이 아님)");
    throw new ClassifyError(502, "AI_BAD_RESPONSE", "AI 답이 정해진 모양이 아닙니다");
  }
  if (answer.missing > 0 || answer.invalid > 0) {
    console.warn(`[classify] 일부 문장을 ${UNDECIDABLE}로 채움: 빠짐 ${answer.missing}, 허용 밖 ${answer.invalid}`);
  }
  return answer.items;
}
