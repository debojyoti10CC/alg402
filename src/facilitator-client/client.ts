import type {
  FacilitatorClient,
  SettleResponse,
  SignedPayload,
  SupportedResponse,
  VerifyResponse,
} from "../core/types.js";
import type { FacilitatorRequestBody } from "./types.js";

export interface HttpFacilitatorClientOptions {
  baseUrl: string;
  /** Per-request timeout in ms. Also used by U2's connection-kill simulation. */
  timeoutMs?: number;
  headers?: Record<string, string>;
}

/**
 * Thin HTTP wrapper over a real x402 facilitator's REST surface
 * (`GET /supported`, `POST /verify`, `POST /settle`). Deliberately hand-rolled
 * against the raw endpoints rather than reusing @x402/core's HTTPFacilitatorClient,
 * which is built for a resource-server's 402-retry flow — Ward acts as its own
 * protocol-level test harness and needs to POST crafted/tampered bodies directly.
 */
export class HttpFacilitatorClient implements FacilitatorClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly headers: Record<string, string>;

  constructor(options: HttpFacilitatorClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.headers = options.headers ?? {};
  }

  async verify(payload: SignedPayload): Promise<VerifyResponse> {
    return this.post<VerifyResponse>("/verify", this.toRequestBody(payload));
  }

  async settle(payload: SignedPayload): Promise<SettleResponse> {
    return this.post<SettleResponse>("/settle", this.toRequestBody(payload));
  }

  async supported(): Promise<SupportedResponse> {
    const res = await fetch(`${this.baseUrl}/supported`, { headers: this.headers });
    if (!res.ok) {
      throw new Error(`GET /supported failed: ${res.status} ${await safeText(res)}`);
    }
    return (await res.json()) as SupportedResponse;
  }

  /** Exposed for U2, which needs to abort a settle request mid-flight. */
  async settleWithAbort(payload: SignedPayload, signal: AbortSignal): Promise<SettleResponse> {
    return this.post<SettleResponse>("/settle", this.toRequestBody(payload), signal);
  }

  private toRequestBody(payload: SignedPayload): FacilitatorRequestBody {
    return {
      x402Version: payload.paymentPayload.x402Version,
      paymentPayload: payload.paymentPayload,
      paymentRequirements: payload.paymentRequirements,
    };
  }

  private async post<T>(path: string, body: unknown, externalSignal?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("timeout")), this.timeoutMs);
    if (externalSignal) {
      externalSignal.addEventListener("abort", () => controller.abort(externalSignal.reason));
    }
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.headers },
        body: JSON.stringify(body, (_key, v) => (typeof v === "bigint" ? v.toString() : v)),
        signal: controller.signal,
      });
      const text = await res.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error(`POST ${path} returned non-JSON (status ${res.status}): ${text.slice(0, 500)}`);
      }
      return parsed as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<no body>";
  }
}
