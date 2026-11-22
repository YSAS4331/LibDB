export class Index {
  #db;
  #storeName;
  #name;

  constructor(database, storeName, indexName) {
    this.#db = database;
    this.#storeName = storeName;
    this.#name = indexName;
  }

  get(key) {
    return this.#db.execute(this.#storeName, "readonly", (store) =>
      store.index(this.#name).get(key)
    );
  }

  getAll(query, count) {
    return this.#db.execute(this.#storeName, "readonly", (store) =>
      store.index(this.#name).getAll(query, count)
    );
  }

  count(query) {
    return this.#db.execute(this.#storeName, "readonly", (store) =>
      store.index(this.#name).count(query)
    );
  }
}
