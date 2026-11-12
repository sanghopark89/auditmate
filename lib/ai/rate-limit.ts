// 설계 §7 — /api/classify 요청 수 상한 (배포 보호를 돕는 보조 수단)
//
// 배포 주소를 아는 누구나 AI 분류를 불러 비용을 쓰지 못하도록, 1분 동안 받을 요청 수에 상한을 둔다.
//  - 접속자(주소)별 상한과 서버 전체 상한, 두 가지를 본다.
//  - 상한은 서버 한 대(Vercel 인스턴스) 안에서만 센다. 인스턴스가 여러 개면 합쳐서는 더 많이 받을 수 있으므로,
//    비용을 완전히 막는 장치가 아니라 "실수·반복 호출 방지"용이다. 완전한 보호는 Vercel 배포 보호(접속 비밀번호)로 한다.
//  - 넘으면 429(RATE_LIMITED)와 Retry-After를 돌려준다. 브라우저는 429를 기다렸다 다시 보낸다(설계 §4.2).
//  - 문장 내용은 다루지 않고, 접속자 주소는 메모리에서 1분만 들고 있다가 버린다 (저장하지 않음).
//
// 기본값: 접속자당 분당 200번, 서버 전체 분당 1,200번.
//  (실측: 서로 다른 문장 24,000개 = 240묶음을 140초에 보냄 → 분당 약 100번. 기본값은 그보다 조금 넉넉하게)
// 환경변수 CLASSIFY_RATE_PER_IP, CLASSIFY_RATE_GLOBAL(분당 번수)로 바꿀 수 있다.

const WINDOW_MS = 60_000;
const DEFAULT_PER_IP = 200;
const DEFAULT_GLOBAL = 1_200;
/** 주소 기록이 이 수를 넘으면 지난 기록부터 정리한다 (메모리 보호) */
const MAX_TRACKED_CLIENTS = 5_000;
/** 접속자 주소로 쓰는 글자 수 (너무 긴 값으로 메모리를 쓰게 하지 못하도록 자른다) */
const MAX_ID_LENGTH = 64;

function limitFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export interface RateDecision {
  allowed: boolean;
  /** 막혔을 때 다시 시도하기까지 기다릴 초 */
  retryAfterSeconds: number;
}

/** 요청 시각 목록을 1분 창으로 센다 (시험에서 시계를 바꿔 끼울 수 있다) */
export class RateLimiter {
  private readonly perClient = new Map<string, number[]>();
  private global: number[] = [];
  private readonly perClientLimit: number;
  private readonly globalLimit: number;
  private readonly now: () => number;

  constructor(
    perClientLimit: number = limitFromEnv("CLASSIFY_RATE_PER_IP", DEFAULT_PER_IP),
    globalLimit: number = limitFromEnv("CLASSIFY_RATE_GLOBAL", DEFAULT_GLOBAL),
    now: () => number = Date.now,
  ) {
    this.perClientLimit = perClientLimit;
    this.globalLimit = globalLimit;
    this.now = now;
  }

  /** 요청 한 번을 받아도 되는지 정한다. 받아도 되면 횟수에 센다 */
  check(clientId: string): RateDecision {
    const t = this.now();
    const since = t - WINDOW_MS;
    // 주소 기록이 너무 커졌으면 막기 전에 먼저 정리한다 (막힌 요청이 몰려도 메모리가 계속 늘지 않게)
    if (this.perClient.size > MAX_TRACKED_CLIENTS) this.sweep(since);
    clientId = clientId.slice(0, MAX_ID_LENGTH);
    this.global = this.global.filter((time) => time > since);
    const mine = (this.perClient.get(clientId) ?? []).filter((time) => time > since);

    const blocked = mine.length >= this.perClientLimit ? mine : this.global.length >= this.globalLimit ? this.global : null;
    if (blocked) {
      // 가장 오래된 기록이 창에서 빠질 때까지 기다리면 한 자리가 난다
      const wait = Math.ceil((blocked[0] + WINDOW_MS - t) / 1000);
      // 막힌 요청은 새 기록을 만들지 않는다 (이미 있는 주소만 오래된 기록을 정리해 둔다)
      if (this.perClient.has(clientId)) this.perClient.set(clientId, mine);
      return { allowed: false, retryAfterSeconds: Math.max(1, wait) };
    }

    mine.push(t);
    this.global.push(t);
    this.perClient.set(clientId, mine);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  private sweep(since: number): void {
    for (const [id, times] of this.perClient) {
      if (times.length === 0 || times[times.length - 1] <= since) this.perClient.delete(id);
    }
  }
}

/** 요청 머리글에서 접속자 주소를 읽는다. Vercel은 x-forwarded-for의 첫 값에 접속자 주소를 넣어 준다 */
export function clientIdOf(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}

/** 서버 한 대 안에서 함께 쓰는 상한기 */
export const classifyLimiter = new RateLimiter();
