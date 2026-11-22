import { LibDBError, normalizeError } from "./errors.js";

export class Database {
  #db = null;
  #name;
  #ver;
  #stores;

  constructor(name, ver, stores = {}) {
    this.#name = name;
    this.#ver = ver;
    this.#stores = stores;
    this.ready = this.#open();
  }

  #open() {
    return new Promise((resolve, reject) => {
      let req;
      if (this.#ver) {
        req = indexedDB.open(this.#name, this.#ver);
      } else {
        req = indexedDB.open(this.#name);
      }

      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        for (const [name, keyPath] of Object.entries(this.#stores)) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, keyPath ? { keyPath } : undefined);
          }
        }
      };

      req.onsuccess = (e) => {
        this.#db = e.target.result;
        this.#db.onversionchange = () => {
          this.#db?.close();
          this.#db = null;
        };
        resolve(this);
      };

      req.onerror = () => reject(new LibDBError("OPEN_FAILED", "DBの接続に失敗しました", req.error));
      req.onblocked = () => console.warn("Database upgrade blocked.");
    });
  }

  async #ensure() {
    await this.ready;
    if (!this.#db) {
      this.ready = this.#open();
      await this.ready;
    }
  }

  async execute(storeName, mode, operation) {
    await this.#ensure();

    return new Promise((resolve, reject) => {
      const tx = this.#db.transaction(storeName, mode);
      const req = operation(tx.objectStore(storeName));
      let result;

      req.onsuccess = () => {
        result = req.result;
      };
      tx.oncomplete = () => resolve(result);
      req.onerror = () => reject(normalizeError(req.error));
      tx.onabort = () => reject(normalizeError(tx.error));
    });
  }

  close() {
    this.#db?.close();
    this.#db = null;
  }
}
