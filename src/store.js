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
      key === undefined ? s.add(value) : s.add(value, key)
    );
  }

  put(value, key) {
    return this.#db.execute(this.#name, "readwrite", (s) =>
      key === undefined ? s.put(value) : s.put(value, key)
    );
  }

  bulkPut(items) {
    return this.#db.execute(this.#name, "readwrite", (s) =>
      items.map(({ value, key }) =>
        key === undefined ? s.put(value) : s.put(value, key)
      )
    );
  }

  bulkAdd(items) {
    return this.#db.execute(this.#name, "readwrite", (s) =>
      items.map(({ value, key }) =>
        key === undefined ? s.add(value) : s.add(value, key)
      )
    );
  }

  bulkDelete(keys) {
    return this.#db.execute(this.#name, "readwrite", (s) =>
      keys.map((key) => s.delete(key))
    );
  }

  get(key) {
    return this.#db.execute(this.#name, "readonly", (s) => s.get(key));
  }

  getAll(query, count) {
    return this.#db.execute(this.#name, "readonly", (s) => s.getAll(query, count));
  }

  delete(key) {
    return this.#db.execute(this.#name, "readwrite", (s) => s.delete(key));
  }

  clear() {
    return this.#db.execute(this.#name, "readwrite", (s) => s.clear());
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
