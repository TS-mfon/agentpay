import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileStore } from "../../src/server/file-store";
import { emptyState } from "../../src/core/types";
describe("durable local demonstration state", () => {
  it("initializes without a state file and persists atomic updates", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentpay-state-"));
    try {
      const file = join(directory, "nested", "state.json");
      const first = new FileStore(file, emptyState);
      expect((await first.read()).revision).toBe(0);
      await first.update((s) => ({
        ...s,
        rateWindows: [{ key: "request", start: 1, count: 1 }],
      }));
      const second = new FileStore(file, emptyState);
      expect((await second.read()).rateWindows[0].count).toBe(1);
      await Promise.all(
        Array.from({ length: 5 }, () =>
          second.update((s) => ({
            ...s,
            rateWindows: s.rateWindows.map((w) => ({
              ...w,
              count: w.count + 1,
            })),
          })),
        ),
      );
      expect((await first.read()).rateWindows[0].count).toBe(6);
      expect(JSON.parse(await readFile(file, "utf8")).revision).toBe(6);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("does not silently reset corrupt financial state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentpay-state-"));
    try {
      const file = join(directory, "state.json");
      await writeFile(file, "corrupt");
      const store = new FileStore(file, emptyState);
      await expect(store.read()).rejects.toBeDefined();
      await expect(store.update((s) => s)).rejects.toBeDefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("releases the lock after a rejected atomic update", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentpay-state-"));
    try {
      const store = new FileStore(join(directory, "state.json"), emptyState);
      await expect(
        store.update(() => {
          throw new Error("Policy conflict");
        }),
      ).rejects.toThrow("Policy conflict");
      await store.update((s) => s);
      expect((await store.read()).revision).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
