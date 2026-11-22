import { LibDBError, normalizeError } from "./errors.js";

export class Database {
  #db = null;
  #name;
  #ver;
  #stores;
  #opening = null;

  constructor(name, ver, stores = {}) {
    if (typeof name !== "string" || !name) {
      throw new TypeError("DB名は空でない文字列で指定してください");
    }
    if (ver !== undefined && (!Number.isInteger(ver) || ver < 1)) {
      throw new TypeError("DBのバージョンは1以上の整数で指定してください");
    }
    if (!stores || typeof stores !== "object" || Array.isArray(stores)) {
      throw new TypeError("storesはオブジェクトで指定してください");
    }

    this.#name = name;
    this.#ver = ver;
    this.#stores = stores;
    this.ready = this.#open();
  }

  #open() {
    if (this.#opening) return this.#opening;

    this.#opening = new Promise((resolve, reject) => {
      let req;
      let upgradeError = null;

      try {
        req = this.#ver === undefined
          ? indexedDB.open(this.#name)
          : indexedDB.open(this.#name, this.#ver);
      } catch (err) {
        reject(new LibDBError("OPEN_FAILED", "DBの接続に失敗しました", err));
        return;
      }

      req.onupgradeneeded = (e) => {
        const db = e.target.result;

        try {
          for (const [name, keyPath] of Object.entries(this.#stores)) {
            if (!db.objectStoreNames.contains(name)) {
              const options = keyPath === undefined
                ? undefined
                : { keyPath };
              db.createObjectStore(name, options);
            }
          }
        } catch (err) {
          upgradeError = err;
          e.target.transaction.abort();
        }
      };

      req.onsuccess = (e) => {
        this.#db = e.target.result;
        this.#db.onversionchange = () => {
          this.#db?.close();
          this.#db = null;
          this.ready = Promise.resolve(this);
        };
        resolve(this);
      };

      req.onerror = () => {
        reject(new LibDBError(
          "OPEN_FAILED",
          "DBの接続に失敗しました",
          upgradeError || req.error
        ));
      };

      req.onblocked = () => {
        console.warn("Database upgrade blocked.");
      };
    }).finally(() => {
      this.#opening = null;
    });

    this.ready = this.#opening;
    return this.#opening;
  }

  async #ensure() {
    await this.ready;

    if (!this.#db) {
      await this.#open();
    }
  }

  async execute(storeName, mode, operation) {
    await this.#ensure();

    return new Promise((resolve, reject) => {
      try {
        const tx = this.#db.transaction(storeName, mode);
        const req = operation(tx.objectStore(storeName));
        let result;

        if (!req || typeof req !== "object" || !("onsuccess" in req)) {
          throw new TypeError("operationはIDBRequestを返す必要があります");
        }

        req.onsuccess = () => {
          result = req.result;
        };

        req.onerror = () => {
          reject(normalizeError(req.error));
        };

        tx.oncomplete = () => {
          resolve(result);
        };

        tx.onabort = () => {
          reject(normalizeError(tx.error));
        };
      } catch (err) {
        reject(normalizeError(err));
      }
    });
  }

  close() {
    this.#db?.close();
    this.#db = null;
  }
}
