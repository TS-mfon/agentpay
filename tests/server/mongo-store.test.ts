import { describe, it, expect, vi, beforeEach } from "vitest";
import { emptyState } from "../../src/core/types";
const fake = vi.hoisted(() => ({
  document: null as null | { revision: number; state: unknown },
  collisions: 0,
  offline: false,
  connect: vi.fn(),
  close: vi.fn(),
}));
vi.mock("mongodb", () => ({
  MongoClient: class {
    async connect() {
      fake.connect();
      if (fake.offline) throw new Error("Atlas unavailable");
      return this;
    }
    db() {
      return {
        collection: () => ({
          findOne: async () => fake.document,
          updateOne: async (
            _filter: unknown,
            update: { $setOnInsert: { revision: number; state: unknown } },
          ) => {
            fake.document ??= structuredClone(update.$setOnInsert);
          },
          replaceOne: async (
            filter: { revision: number },
            replacement: { revision: number; state: unknown },
          ) => {
            if (fake.collisions > 0) {
              fake.collisions--;
              return { modifiedCount: 0 };
            }
            if (fake.document?.revision !== filter.revision)
              return { modifiedCount: 0 };
            fake.document = structuredClone(replacement);
            return { modifiedCount: 1 };
          },
        }),
      };
    }
    async close() {
      fake.close();
    }
  },
}));
import { MongoStore } from "../../src/server/mongo-store";
beforeEach(() => {
  fake.document = null;
  fake.collisions = 0;
  fake.offline = false;
  fake.connect.mockClear();
  fake.close.mockClear();
});
describe("MongoDB durable CAS store", () => {
  it("initializes one durable state document and updates against its revision", async () => {
    const store = new MongoStore(
      "mongodb://fixture",
      "agentpay_test",
      emptyState,
    );
    expect((await store.read()).revision).toBe(0);
    const state = await store.update((s) => ({
      ...s,
      rateWindows: [{ key: "agent", start: 1, count: 1 }],
    }));
    expect(state.revision).toBe(1);
    const another = new MongoStore(
      "mongodb://fixture",
      "agentpay_test",
      emptyState,
    );
    expect((await another.read()).rateWindows[0].count).toBe(1);
    await store.close();
    expect(fake.close).toHaveBeenCalled();
  });
  it("retries conflicting compare-and-swap without dropping an update", async () => {
    const store = new MongoStore(
      "mongodb://fixture",
      "agentpay_test",
      emptyState,
    );
    await store.read();
    fake.collisions = 2;
    const updated = await store.update((s) => ({
      ...s,
      workerLease: { token: "worker", expiresAt: 123 },
    }));
    expect(updated.workerLease?.token).toBe("worker");
    expect(updated.revision).toBe(1);
  });
  it("fails closed after contention and database outage", async () => {
    const store = new MongoStore(
      "mongodb://fixture",
      "agentpay_test",
      emptyState,
    );
    await store.read();
    fake.collisions = 20;
    await expect(store.update((s) => s)).rejects.toThrow("contention");
    fake.offline = true;
    await expect(store.read()).rejects.toThrow("Atlas unavailable");
  });
});
