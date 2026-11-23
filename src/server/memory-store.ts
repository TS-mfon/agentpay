import type { AtomicStore } from "../core/ports";
import type { State } from "../core/types";
export class MemoryStore implements AtomicStore {
  private state: State;
  constructor(initial: State) {
    this.state = structuredClone(initial);
  }
  async read() {
    return structuredClone(this.state);
  }
  async update(transform: (state: State) => State) {
    const next = transform(structuredClone(this.state));
    this.state = structuredClone({
      ...next,
      revision: this.state.revision + 1,
    });
    return this.read();
  }
}
