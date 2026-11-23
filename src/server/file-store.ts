import { mkdir, readFile, writeFile, rename, rmdir } from "node:fs/promises";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import type { AtomicStore } from "../core/ports";
import type { State } from "../core/types";
export class FileStore implements AtomicStore {
  constructor(
    private readonly path: string,
    private readonly initial: () => State,
  ) {}
  private async load() {
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as State;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return this.initial();
      throw error;
    }
  }
  async read() {
    await mkdir(dirname(this.path), { recursive: true });
    return this.load();
  }
  async update(transform: (state: State) => State) {
    await mkdir(dirname(this.path), { recursive: true });
    const lock = this.path + ".lock";
    let acquired = false;
    for (let i = 0; i < 100; i++) {
      try {
        await mkdir(lock);
        acquired = true;
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    if (!acquired) throw new Error("Local state lock unavailable");
    try {
      const state = await this.load();
      const next = {
        ...transform(structuredClone(state)),
        revision: state.revision + 1,
      };
      const temporary =
        this.path + "." + randomBytes(8).toString("hex") + ".tmp";
      await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
      await rename(temporary, this.path);
      return structuredClone(next);
    } finally {
      await rmdir(lock);
    }
  }
}
