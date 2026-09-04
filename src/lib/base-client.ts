/**
 * HTTP client for the Base.com API (formerly BaseLinker).
 *
 * Deliberately free of any Medusa dependency, so it can be reused by the
 * recon script and unit-tested offline against recorded fixtures.
 *
 * The Base.com API is a single POST endpoint that always responds with
 * HTTP 200 and signals failures through a `status: "ERROR"` body field.
 */

export type BaseApiStatus = "SUCCESS" | "ERROR";

export interface BaseApiEnvelope {
  status: BaseApiStatus;
  error_code?: string;
  error_message?: string;
  [key: string]: unknown;
}

export interface BaseLoggerLike {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

export interface BaseClientOptions {
  apiKey: string;
  /** Defaults to the official connector endpoint. */
  apiUrl?: string;
  /** Request budget per time window. Base.com allows 100/min. */
  requestsPerMinute?: number;
  /** Number of retries for transient failures. */
  maxRetries?: number;
  /** Per-request timeout in ms. */
  timeoutMs?: number;
  logger?: BaseLoggerLike;
  /** Injectable fetch/sleep - keeps tests network-free and instant. */
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
}

export class BaseApiError extends Error {
  readonly method: string;
  readonly code?: string;
  readonly httpStatus?: number;
  readonly retryable: boolean;

  constructor(
    message: string,
    opts: {
      method: string;
      code?: string;
      httpStatus?: number;
      retryable?: boolean;
      cause?: unknown;
    }
  ) {
    super(message, { cause: opts.cause });
    this.name = "BaseApiError";
    this.method = opts.method;
    this.code = opts.code;
    this.httpStatus = opts.httpStatus;
    this.retryable = opts.retryable ?? false;
  }
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const noopLogger: BaseLoggerLike = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Sliding-window limiter. Base.com counts requests per minute, so a fixed
 * delay between calls would waste throughput on short bursts - a window lets
 * a burst through first and only then makes the caller wait.
 */
export class SlidingWindowRateLimiter {
  private timestamps: number[] = [];

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
    private readonly now: () => number = Date.now
  ) {}

  async acquire(): Promise<void> {
    for (;;) {
      const now = this.now();
      this.timestamps = this.timestamps.filter(
        (t) => now - t < this.windowMs
      );

      if (this.timestamps.length < this.max) {
        this.timestamps.push(now);
        return;
      }

      // Wait until the oldest entry falls out of the window.
      const waitMs = this.windowMs - (now - this.timestamps[0]) + 10;
      await this.sleep(waitMs);
    }
  }
}

/** Base.com error codes worth retrying instead of aborting the whole sync. */
const RETRYABLE_CODE_PATTERNS = [/LIMIT/i, /TEMPORAR/i, /BUSY/i, /TIMEOUT/i];

const isRetryableCode = (code?: string): boolean =>
  !!code && RETRYABLE_CODE_PATTERNS.some((p) => p.test(code));

export class BaseClient {
  private readonly apiKey: string;
  private readonly apiUrl: string;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly logger: BaseLoggerLike;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly limiter: SlidingWindowRateLimiter;

  constructor(options: BaseClientOptions) {
    if (!options.apiKey) {
      throw new Error("Base.com: api_key is missing from the plugin options");
    }

    this.apiKey = options.apiKey;
    this.apiUrl = options.apiUrl ?? "https://api.baselinker.com/connector.php";
    this.maxRetries = options.maxRetries ?? 3;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.logger = options.logger ?? noopLogger;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleepImpl ?? defaultSleep;
    this.limiter = new SlidingWindowRateLimiter(
      options.requestsPerMinute ?? 100,
      60_000,
      this.sleep
    );
  }

  /**
   * Performs a single API method call with rate limiting and retries.
   * Returns the raw response envelope.
   */
  async call<T extends BaseApiEnvelope = BaseApiEnvelope>(
    method: string,
    parameters: Record<string, unknown> = {}
  ): Promise<T> {
    let lastError: BaseApiError | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      await this.limiter.acquire();

      try {
        return await this.callOnce<T>(method, parameters);
      } catch (error) {
        const apiError =
          error instanceof BaseApiError
            ? error
            : new BaseApiError(
                `Base.com: request ${method} failed: ${
                  (error as Error)?.message ?? String(error)
                }`,
                { method, retryable: true, cause: error }
              );

        lastError = apiError;

        if (!apiError.retryable || attempt === this.maxRetries) {
          throw apiError;
        }

        const backoffMs = Math.min(2 ** attempt * 1000, 15_000);
        this.logger.warn(
          `Base.com: ${method} failed (attempt ${attempt + 1}/${
            this.maxRetries + 1
          }): ${apiError.message}. Retrying in ${backoffMs}ms`
        );
        await this.sleep(backoffMs);
      }
    }

    throw lastError!;
  }

  private async callOnce<T extends BaseApiEnvelope>(
    method: string,
    parameters: Record<string, unknown>
  ): Promise<T> {
    this.logger.debug(`Base.com: calling ${method}`);

    const response = await this.fetchImpl(this.apiUrl, {
      method: "POST",
      headers: {
        "X-BLToken": this.apiKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        method,
        parameters: JSON.stringify(parameters),
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new BaseApiError(
        `Base.com: ${method} returned HTTP ${response.status}`,
        {
          method,
          httpStatus: response.status,
          // 429 and 5xx are transient, other 4xx are not.
          retryable: response.status === 429 || response.status >= 500,
        }
      );
    }

    const data = (await response.json()) as T;

    if (data?.status === "ERROR") {
      throw new BaseApiError(
        `Base.com: ${method} - ${data.error_message} (${data.error_code})`,
        {
          method,
          code: data.error_code,
          retryable: isRetryableCode(data.error_code),
        }
      );
    }

    return data;
  }
}
