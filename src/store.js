import { Database } from "./database.js";
import { Store } from "./store.js";

export { LibDBError } from "./errors.js";

export class LibDB {
  #database;
  #storeCache = new Map();

  constructor(name, ver = 1, stores = {}) {
    this.#database = new Database(name, ver, stores);
  }

  get ready() {
    return this.#database.ready;
  }

  store(name) {
    if (!this.#storeCache.has(name)) {
      this.#storeCache.set(name, new Store(this.#database, name));
    }
    return this.#storeCache.get(name);
  }

  close() {
    this.#database.close();
    this.#storeCache.clear();
  }
}
