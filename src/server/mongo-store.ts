import { MongoClient } from "mongodb";
import type { AtomicStore } from "../core/ports";
import type { State } from "../core/types";
interface Document {
  _id: string;
  revision: number;
  state: State;
}
export class MongoStore implements AtomicStore {
  private readonly client: MongoClient;
  constructor(
    uri: string,
    private readonly database: string,
    private readonly initial: () => State,
    private readonly namespace: string = "live",
  ) {
    this.client = new MongoClient(uri, {
      maxPoolSize: 3,
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000,
    });
  }
  private async collection() {
    await this.client.connect();
    return this.client.db(this.database).collection<Document>("runtime");
  }
  async read() {
    const collection = await this.collection();
    const found = await collection.findOne({
      _id: "agentpay:" + this.namespace,
    });
    if (found) return structuredClone(found.state);
    const initial = this.initial();
    await collection.updateOne(
      { _id: "agentpay:" + this.namespace },
      { $setOnInsert: { revision: 0, state: initial } },
      { upsert: true },
    );
    const created = await collection.findOne({
      _id: "agentpay:" + this.namespace,
    });
    if (!created) throw new Error("Durable state initialization failed");
    return structuredClone(created.state);
  }
  async update(transform: (state: State) => State) {
    const collection = await this.collection();
    for (let attempt = 0; attempt < 12; attempt++) {
      const current = await this.read();
      const next = {
        ...transform(structuredClone(current)),
        revision: current.revision + 1,
      };
      const result = await collection.replaceOne(
        { _id: "agentpay:" + this.namespace, revision: current.revision },
        { revision: next.revision, state: next },
      );
      if (result.modifiedCount === 1) return structuredClone(next);
    }
    throw new Error("Durable state contention; retry the request");
  }
  async close() {
    await this.client.close();
  }
}
