export class Store {
  #db;
  #name;

  constructor(database, storeName) {
    this.#db = database;
    this.#name = storeName;
  }

  add(data) {
    return this.#db.execute(this.#name, "readwrite", (s) => s.add(data));
  }

  put(data) {
    return this.#db.execute(this.#name, "readwrite", (s) => s.put(data));
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
}
