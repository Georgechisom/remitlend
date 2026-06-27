import express from "express";
import request from "supertest";
import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";

const mockCreateWebhookSubscription = jest.fn((req, res) => {
  res.status(201).json({ success: true });
});
const mockQuery = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });

jest.unstable_mockModule("../controllers/indexerController.js", () => ({
  getIndexerStatus: jest.fn((req, res) => res.json({ success: true })),
  getBorrowerEvents: jest.fn((req, res) => res.json({ success: true })),
  getLoanEvents: jest.fn((req, res) => res.json({ success: true })),
  getRecentEvents: jest.fn((req, res) => res.json({ success: true })),
  listWebhookSubscriptions: jest.fn((req, res) =>
    res.json({ success: true, data: [] }),
  ),
  createWebhookSubscription: mockCreateWebhookSubscription,
  deleteWebhookSubscription: jest.fn((req, res) =>
    res.json({ success: true }),
  ),
}));

jest.unstable_mockModule("../db/connection.js", () => ({
  query: mockQuery,
  default: { query: mockQuery, connect: jest.fn(), end: jest.fn() },
}));

const { default: indexerRoutes } = await import("../routes/indexerRoutes.js");
const { errorHandler } = await import("../middleware/errorHandler.js");

const originalApiKeys = process.env.INTERNAL_API_KEY;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/indexer", indexerRoutes);
  app.use(errorHandler);
  return app;
}

describe("indexer route API key scopes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.INTERNAL_API_KEY =
      "admin:disputes:dispute-value,admin:webhooks:webhook-value,admin:indexer:indexer-value";
  });

  afterEach(() => {
    if (originalApiKeys === undefined) {
      delete process.env.INTERNAL_API_KEY;
    } else {
      process.env.INTERNAL_API_KEY = originalApiKeys;
    }
  });

  it("rejects a disputes-scoped key on POST /api/indexer/webhooks", async () => {
    await request(buildApp())
      .post("/api/indexer/webhooks")
      .set("x-api-key", "dispute-value")
      .send({
        callbackUrl: "https://example.com/webhook",
        eventTypes: ["LoanRequested"],
      })
      .expect(403);

    expect(mockCreateWebhookSubscription).not.toHaveBeenCalled();
  });

  it("allows a webhooks-scoped key on POST /api/indexer/webhooks", async () => {
    await request(buildApp())
      .post("/api/indexer/webhooks")
      .set("x-api-key", "webhook-value")
      .send({
        callbackUrl: "https://example.com/webhook",
        eventTypes: ["LoanRequested"],
      })
      .expect(201);

    expect(mockCreateWebhookSubscription).toHaveBeenCalledTimes(1);
  });
});
