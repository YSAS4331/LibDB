import { LibDBError, normalizeError } from "./errors.js";

export class Database {
  static #connections = new Map();

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

  #normalizeStoreDefinition(definition) {
    if (typeof definition === "string" || Array.isArray(definition)) {
      return { keyPath: definition };
    }
    if (definition === undefined) return {};
    if (!definition || typeof definition !== "object") {
      throw new TypeError("ストア定義は文字列またはオブジェクトで指定してください");
    }
    return definition;
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
        const upgradeTx = e.target.transaction;

        try {
          for (const [name, rawDefinition] of Object.entries(this.#stores)) {
            const definition = this.#normalizeStoreDefinition(rawDefinition);
            const { keyPath, autoIncrement, indexes = [] } = definition;

            let store;
            if (!db.objectStoreNames.contains(name)) {
              const options = {};
              if (keyPath !== undefined) options.keyPath = keyPath;
              if (autoIncrement !== undefined) options.autoIncrement = autoIncrement;
              store = db.createObjectStore(name, options);
            } else {
              store = upgradeTx.objectStore(name);
            }

            if (!Array.isArray(indexes)) {
              throw new TypeError(`ストア「${name}」のindexesは配列で指定してください`);
            }

            for (const index of indexes) {
              if (!index || typeof index.name !== "string" || !index.name || index.keyPath === undefined) {
                throw new TypeError(`ストア「${name}」のインデックス定義が不正です`);
              }
              if (!store.indexNames.contains(index.name)) {
                store.createIndex(index.name, index.keyPath, index.options || {});
              }
            }
          }
        } catch (err) {
          upgradeError = err;
          upgradeTx.abort();
        }
      };

      req.onsuccess = (e) => {
        this.#db = e.target.result;
        let connections = Database.#connections.get(this.#name);
        if (!connections) {
          connections = new Set();
          Database.#connections.set(this.#name, connections);
        }
        connections.add(this);
        this.#db.onversionchange = () => {
          this.close();
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
    if (!this.#db) await this.#open();
  }

  async transaction(storeNames, mode, callback) {
    if (typeof callback !== "function") {
      throw new TypeError("callbackは関数で指定してください");
    }

    await this.#ensure();

    return new Promise((resolve, reject) => {
      let tx;
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(normalizeError(error));
      };

      try {
        tx = this.#db.transaction(storeNames, mode);
        let result;
        let lastError = null;

        tx.onerror = (e) => {
          lastError = e.target?.error || tx.error || lastError;
        };
        tx.onabort = () => fail(tx.error || lastError);
        tx.oncomplete = () => {
          if (settled) return;
          settled = true;
          resolve(result);
        };

        const names = Array.isArray(storeNames) ? storeNames : [storeNames];
        const stores = Object.fromEntries(
          names.map((name) => [name, tx.objectStore(name)])
        );
        result = callback(stores, tx);

        if (result && typeof result.then === "function") {
          throw new TypeError("transactionのcallback内ではawaitしないでください");
        }
      } catch (err) {
        try { tx?.abort(); } catch {}
        fail(err);
      }
    });
  }

  async execute(storeName, mode, operation) {
    let requests;
    const results = [];

    await this.transaction(storeName, mode, (stores) => {
      requests = operation(stores[storeName]);
      const list = Array.isArray(requests) ? requests : [requests];

      for (const [index, req] of list.entries()) {
        if (!req || typeof req !== "object" || !("onsuccess" in req)) {
          throw new TypeError("operationはIDBRequestまたはその配列を返す必要があります");
        }
        req.onsuccess = () => {
          results[index] = req.result;
        };
      }
    });

    return Array.isArray(requests) ? results : results[0];
  }

  close() {
    this.#db?.close();
    this.#db = null;

    const connections = Database.#connections.get(this.#name);
    connections?.delete(this);
    if (connections?.size === 0) Database.#connections.delete(this.#name);
  }

  static delete(name) {
    if (typeof name !== "string" || !name) {
      return Promise.reject(new TypeError("DB名は空でない文字列で指定してください"));
    }

    for (const connection of [...(Database.#connections.get(name) || [])]) {
      connection.close();
    }

    return new Promise((resolve, reject) => {
      let request;
      try {
        request = indexedDB.deleteDatabase(name);
      } catch (error) {
        reject(error);
        return;
      }

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => {
        console.warn("Database deletion blocked: " + name);
      };
    });
  }
}
