import assert from "node:assert/strict";
import { test, describe } from "node:test";
import {
  BaseClient,
  BaseApiError,
  SlidingWindowRateLimiter,
} from "../base-client";

/** Builds a fetch stub that returns the prepared responses in order. */
const fetchReturning = (
  responses: Array<{ status?: number; body: unknown }>
) => {
  const calls: Array<{ method: string; parameters: any }> = [];
  let index = 0;

  const impl = (async (_url: string, init: any) => {
    const params = new URLSearchParams(init.body as string);
    calls.push({
      method: params.get("method")!,
      parameters: JSON.parse(params.get("parameters")!),
    });

    const next = responses[Math.min(index++, responses.length - 1)];
    return {
      ok: (next.status ?? 200) < 400,
      status: next.status ?? 200,
      json: async () => next.body,
    };
  }) as unknown as typeof fetch;

  return { impl, calls };
};

const makeClient = (
  responses: Array<{ status?: number; body: unknown }>,
  overrides: Record<string, unknown> = {}
) => {
  const { impl, calls } = fetchReturning(responses);
  const sleeps: number[] = [];

  const client = new BaseClient({
    apiKey: "test-key",
    fetchImpl: impl,
    sleepImpl: async (ms) => {
      sleeps.push(ms);
    },
    ...overrides,
  });

  return { client, calls, sleeps };
};

describe("BaseClient", () => {
  test("requires an API key", () => {
    assert.throws(
      () => new BaseClient({ apiKey: "" }),
      /api_key is missing/
    );
  });

  test("sends the method and parameters in connector format", async () => {
    const { client, calls } = makeClient([
      { body: { status: "SUCCESS", inventories: [] } },
    ]);

    await client.call("getInventories", { inventory_id: "42" });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "getInventories");
    assert.deepEqual(calls[0].parameters, { inventory_id: "42" });
  });

  test("turns an ERROR status in the response body into an exception", async () => {
    const { client } = makeClient([
      {
        body: {
          status: "ERROR",
          error_code: "ERROR_AUTH_TOKEN",
          error_message: "Invalid token",
        },
      },
    ]);

    await assert.rejects(
      () => client.call("getInventories"),
      (error: BaseApiError) => {
        assert.equal(error.code, "ERROR_AUTH_TOKEN");
        assert.equal(error.retryable, false);
        return true;
      }
    );
  });

  test("does not retry non-retryable failures", async () => {
    const { client, calls } = makeClient([
      {
        body: {
          status: "ERROR",
          error_code: "ERROR_AUTH_TOKEN",
          error_message: "Invalid token",
        },
      },
    ]);

    await assert.rejects(() => client.call("getInventories"));
    assert.equal(calls.length, 1);
  });

  test("retries a rate-limit failure and returns the result", async () => {
    const { client, calls, sleeps } = makeClient([
      {
        body: {
          status: "ERROR",
          error_code: "ERROR_RATE_LIMIT",
          error_message: "Too many requests",
        },
      },
      { body: { status: "SUCCESS", inventories: [] } },
    ]);

    const result = await client.call("getInventories");

    assert.equal(result.status, "SUCCESS");
    assert.equal(calls.length, 2);
    assert.ok(sleeps.includes(1000), "should back off before retrying");
  });

  test("retries HTTP 5xx but not HTTP 400", async () => {
    const retryable = makeClient([
      { status: 503, body: {} },
      { body: { status: "SUCCESS" } },
    ]);
    await retryable.client.call("getInventories");
    assert.equal(retryable.calls.length, 2);

    const fatal = makeClient([{ status: 400, body: {} }]);
    await assert.rejects(() => fatal.client.call("getInventories"));
    assert.equal(fatal.calls.length, 1);
  });

  test("gives up once retries are exhausted", async () => {
    const { client, calls } = makeClient(
      [{ status: 500, body: {} }],
      { maxRetries: 2 }
    );

    await assert.rejects(() => client.call("getInventories"));
    assert.equal(calls.length, 3, "initial attempt + 2 retries");
  });
});

describe("SlidingWindowRateLimiter", () => {
  test("lets a burst through up to the limit without waiting", async () => {
    const sleeps: number[] = [];
    const limiter = new SlidingWindowRateLimiter(
      3,
      60_000,
      async (ms) => {
        sleeps.push(ms);
      },
      () => 1_000
    );

    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();

    assert.deepEqual(sleeps, []);
  });

  test("waits while the window is full and releases once it slides", async () => {
    const sleeps: number[] = [];
    let now = 1_000;

    const limiter = new SlidingWindowRateLimiter(
      2,
      60_000,
      async (ms) => {
        sleeps.push(ms);
        // Simulate the passage of time that pushes old entries out of the window.
        now += ms;
      },
      () => now
    );

    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();

    assert.equal(sleeps.length, 1);
    assert.equal(sleeps[0], 60_010);
  });
});
