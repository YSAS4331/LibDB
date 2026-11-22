import { Index } from "./index-store.js";

export class Store {
  #db;
  #name;

  constructor(database, storeName) {
    this.#db = database;
    this.#name = storeName;
  }

  add(value, key) {
    return this.#db.execute(this.#name, "readwrite", (s) =>
      key === undefined ? s.add(value) : s.add(value, key), "add",
      { type: "add", items: [{ value, key }] }
    );
  }

  put(value, key) {
    return this.#db.execute(this.#name, "readwrite", (s) =>
      key === undefined ? s.put(value) : s.put(value, key), "put",
      { type: "put", items: [{ value, key }] }
    );
  }

  bulkPut(items) {
    if (!items.length) return Promise.resolve([]);

    return this.#db.execute(this.#name, "readwrite", (s) =>
      items.map((value) => s.put(value)), "bulkPut",
      { type: "put", items: items.map((value) => ({ value })) }
    );
  }

  bulkAdd(items) {
    if (!items.length) return Promise.resolve([]);

    return this.#db.execute(this.#name, "readwrite", (s) =>
      items.map((value) => s.add(value)), "bulkAdd",
      { type: "add", items: items.map((value) => ({ value })) }
    );
  }

  bulkDelete(keys) {
    if (!keys.length) return Promise.resolve([]);

    return this.#db.execute(this.#name, "readwrite", (s) =>
      keys.map((key) => s.delete(key)), "bulkDelete",
      { type: "delete", items: keys.map((key) => ({ key })) }
    );
  }

  get(key) {
    return this.#db.execute(this.#name, "readonly", (s) => s.get(key));
  }

  getAll(query, count) {
    return this.#db.execute(this.#name, "readonly", (s) => s.getAll(query, count));
  }

  delete(key) {
    return this.#db.execute(this.#name, "readwrite", (s) => s.delete(key), "delete",
      { type: "delete", items: [{ key }] }
    );
  }

  clear() {
    return this.#db.execute(this.#name, "readwrite", (s) => s.clear(), "clear",
      { type: "clear" }
    );
  }

  count(query) {
    return this.#db.execute(this.#name, "readonly", (s) => s.count(query));
  }

  getAllKeys(query, count) {
    return this.#db.execute(this.#name, "readonly", (s) => s.getAllKeys(query, count));
  }

  index(name) {
    return new Index(this.#db, this.#name, name);
  }
}
