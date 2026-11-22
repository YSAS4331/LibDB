import { Database } from "./database.js";
import { Store } from "./store.js";

export { LibDBError } from "./errors.js";

export class LibDB {
  #database;
  #storeCache = new Map();

  static get diff() {
    return Database.diff;
  }

  static set diff(enabled) {
    if (typeof enabled !== "boolean") {
      throw new TypeError("LibDB.diffはbooleanで指定してください");
    }
    Database.diff = enabled;
  }

  static delete(name) {
    return Database.delete(name);
  }

  constructor(name, ver, stores = {}) {
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

  on(type, callback) {
    return this.#database.on(type, callback);
  }

  off(type, callback) {
    return this.#database.off(type, callback);
  }

  transaction(storeNames, mode, callback) {
    return this.#database.transaction(storeNames, mode, callback);
  }

  close() {
    this.#database.close();
    this.#storeCache.clear();
  }
}
