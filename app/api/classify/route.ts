// 계획 작업 11 / 설계 §4.2 — POST /api/classify
// 이용현황 문장 묶음(최대 100문장, 문장당 최대 500자)을 받아 AI로 분류한 결과를 돌려준다.
// 브라우저가 파일을 읽고 개인정보를 가린 뒤 문장만 보낸다. 파일 원본은 이 서버로 오지 않는다.

import { ClassifyError, classifyWithAi } from "@/lib/ai/classify";
import { classifyRequestSchema } from "@/lib/ai/classify-shared";
import { classifyLimiter, clientIdOf } from "@/lib/ai/rate-limit";
import type { ClassifyErrorBody, ClassifyResponse } from "@/lib/ai/classify-shared";

// 서버가 한 요청에 쓸 수 있는 최대 시간(초). AI 응답 시간을 잰 뒤 조정한다 (설계 §2.4)
export const maxDuration = 60;

function errorResponse(status: number, code: string, message: string) {
  const body: ClassifyErrorBody = { error: { code, message } };
  return Response.json(body, { status });
}

/** 요청 검사 오류를 사람이 읽을 문구로 바꾼다 */
function invalidMessage(issues: readonly { code: string; path: PropertyKey[] }[]): string {
  const tooBigSentences = issues.some((i) => i.code === "too_big" && i.path.length === 1 && i.path[0] === "sentences");
  if (tooBigSentences) return "한 번에 100문장까지 보낼 수 있습니다";
  const tooBigText = issues.some((i) => i.code === "too_big" && i.path.includes("text"));
  if (tooBigText) return "문장은 500자까지 보낼 수 있습니다";
  return "요청 모양이 올바르지 않습니다. sentences에 id와 text가 있는 문장을 1~100개 담아 보내 주세요";
}

export async function POST(request: Request) {
  // 요청 수 상한 (설계 §7): 넘으면 429로 돌려 보내고, 브라우저가 기다렸다 다시 보낸다
  const decision = classifyLimiter.check(clientIdOf(request.headers));
  if (!decision.allowed) {
    const limited: ClassifyErrorBody = { error: { code: "RATE_LIMITED", message: "요청이 너무 많습니다. 잠시 뒤 다시 시도해 주세요" } };
    return Response.json(limited, { status: 429, headers: { "Retry-After": String(decision.retryAfterSeconds) } });
  }

  // 출처 검사: 다른 사이트가 방문자 브라우저로 이 API를 부르지 못하게 한다
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin" && site !== "none") {
    return errorResponse(403, "FORBIDDEN", "허용되지 않는 요청입니다");
  }
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return errorResponse(415, "UNSUPPORTED_MEDIA_TYPE", "JSON 형식으로 보내 주세요");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "INVALID_REQUEST", "요청 내용을 읽을 수 없습니다");
  }

  const parsed = classifyRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(400, "INVALID_REQUEST", invalidMessage(parsed.error.issues));
  }

  try {
    const results = await classifyWithAi(parsed.data.sentences);
    const response: ClassifyResponse = { results };
    return Response.json(response);
  } catch (error) {
    if (error instanceof ClassifyError) return errorResponse(error.status, error.code, error.message);
    console.error("[classify] 예상하지 못한 오류");
    return errorResponse(500, "INTERNAL_ERROR", "서버에서 문제가 생겼습니다");
  }
}
