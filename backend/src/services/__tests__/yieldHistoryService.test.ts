import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const mockQuery =
  jest.fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>>();

jest.unstable_mockModule("../../db/connection.js", () => ({
  query: mockQuery,
}));

const { buildDepositorYieldHistory, computeApy, normalizeYieldHistoryDays } =
  await import("../yieldHistoryService.js");

describe("yieldHistoryService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.LENDING_POOL_CONTRACT_ID = "CPoolContract";
  });

  it("normalizes days to allowed ranges", () => {
    expect(normalizeYieldHistoryDays(7)).toBe(7);
    expect(normalizeYieldHistoryDays(90)).toBe(90);
    expect(normalizeYieldHistoryDays(undefined)).toBe(30);
    expect(normalizeYieldHistoryDays(14)).toBe(30);
  });

  it("computes annualized APY from period return", () => {
    const apy = computeApy(10, 100, 30);
    expect(apy).toBeCloseTo(121.67, 1);
  });

  it("returns empty history when depositor has no events", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const history = await buildDepositorYieldHistory(
      "GDepositor",
      "GToken",
      30,
    );
    expect(history).toEqual([]);
  });

  it("aggregates deposit and yield into increasing net yield", async () => {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          event_type: "Deposit",
          amount: "1000",
          ledger_closed_at: yesterday,
          value: null,
        },
        {
          event_type: "YieldDistributed",
          amount: "100",
          ledger_closed_at: now,
          value: null,
        },
      ],
    });

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          event_type: "Deposit",
          amount: "1000",
          ledger_closed_at: yesterday,
          value: null,
        },
      ],
    });

    const history = await buildDepositorYieldHistory(
      "GDepositor",
      "GToken",
      7,
      1_100_000,
    );

    expect(history.length).toBeGreaterThan(0);
    const latest = history[history.length - 1]!;
    expect(latest.depositedValue).toBe(1000);
    expect(latest.currentValue).toBeGreaterThanOrEqual(1000);
    expect(latest.netYield).toBeGreaterThanOrEqual(0);
  });
});
