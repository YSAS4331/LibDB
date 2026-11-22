import { LibDBError, normalizeError } from "./errors.js";

const CONTEXT_ID = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random()}`;

export class Database {
  static #connections = new Map();
  static diff = true;

  #db = null;
  #name;
  #ver;
  #stores;
  #opening = null;
  #channel = null;
  #listeners = new Map();

  constructor(name, ver, stores = {}) {
    if (typeof name !== "string" || !name) {
      throw new TypeError("DB名は空でない文字列で指定してください");
    }
    if (ver !== undefined && ver !== "auto" && (!Number.isInteger(ver) || ver < 1)) {
      throw new TypeError("DBのバージョンは1以上の整数または\"auto\"で指定してください");
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

  #applyStoreDefinitions(db, upgradeTx) {
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
        if (keyPath !== undefined && JSON.stringify(store.keyPath) !== JSON.stringify(keyPath)) {
          throw new TypeError(`ストア「${name}」のkeyPathは既存定義と一致しません`);
        }
        if (autoIncrement !== undefined && store.autoIncrement !== autoIncrement) {
          throw new TypeError(`ストア「${name}」のautoIncrementは既存定義と一致しません`);
        }
      }

      if (!Array.isArray(indexes)) {
        throw new TypeError(`ストア「${name}」のindexesは配列で指定してください`);
      }

      for (const index of indexes) {
        if (!index || typeof index.name !== "string" || !index.name || index.keyPath === undefined) {
          throw new TypeError(`ストア「${name}」のインデックス定義が不正です`);
        }
        if (store.indexNames.contains(index.name)) {
          const current = store.index(index.name);
          const options = index.options || {};
          if (
            JSON.stringify(current.keyPath) !== JSON.stringify(index.keyPath) ||
            current.unique !== Boolean(options.unique) ||
            current.multiEntry !== Boolean(options.multiEntry)
          ) {
            throw new TypeError(`インデックス「${name}.${index.name}」は既存定義と一致しません`);
          }
        } else {
          store.createIndex(index.name, index.keyPath, index.options || {});
        }
      }
    }
  }

  #openAuto() {
    const open = (version) => new Promise((resolve, reject) => {
      let request;
      let upgradeError = null;
      try {
        request = version === undefined
          ? indexedDB.open(this.#name)
          : indexedDB.open(this.#name, version);
      } catch (error) {
        reject(error);
        return;
      }

      request.onupgradeneeded = (event) => {
        try {
          this.#applyStoreDefinitions(event.target.result, event.target.transaction);
        } catch (error) {
          upgradeError = error;
          event.target.transaction.abort();
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(upgradeError || request.error);
      request.onblocked = () => console.warn("Database upgrade blocked.");
    });

    return (async () => {
      let db = await open();
      try {
        if (db.version > 0) {
          const missing = [];
          const tx = db.objectStoreNames.length
            ? db.transaction([...db.objectStoreNames], "readonly")
            : null;
          for (const [name, rawDefinition] of Object.entries(this.#stores)) {
            const definition = this.#normalizeStoreDefinition(rawDefinition);
            const { keyPath, autoIncrement, indexes = [] } = definition;
            if (!db.objectStoreNames.contains(name)) {
              missing.push(name);
              continue;
            }
            const store = tx.objectStore(name);
            if (keyPath !== undefined && JSON.stringify(store.keyPath) !== JSON.stringify(keyPath)) {
              throw new TypeError(`ストア「${name}」のkeyPathは既存定義と一致しません`);
            }
            if (autoIncrement !== undefined && store.autoIncrement !== autoIncrement) {
              throw new TypeError(`ストア「${name}」のautoIncrementは既存定義と一致しません`);
            }
            if (!Array.isArray(indexes)) {
              throw new TypeError(`ストア「${name}」のindexesは配列で指定してください`);
            }
            for (const index of indexes) {
              if (!index || typeof index.name !== "string" || !index.name || index.keyPath === undefined) {
                throw new TypeError(`ストア「${name}」のインデックス定義が不正です`);
              }
              if (store.indexNames.contains(index.name)) {
                const current = store.index(index.name);
                const options = index.options || {};
                if (
                  JSON.stringify(current.keyPath) !== JSON.stringify(index.keyPath) ||
                  current.unique !== Boolean(options.unique) ||
                  current.multiEntry !== Boolean(options.multiEntry)
                ) {
                  throw new TypeError(`インデックス「${name}.${index.name}」は既存定義と一致しません`);
                }
              } else {
                missing.push(name + "." + index.name);
              }
            }
          }
          tx?.abort();
          if (missing.length) {
            const nextVersion = db.version + 1;
            db.close();
            db = await open(nextVersion);
          }
        }
        return db;
      } catch (error) {
        db.close();
        throw error;
      }
    })();
  }

  #setupChannel() {
    if (this.#channel || typeof BroadcastChannel === "undefined") return;

    try {
      this.#channel = new BroadcastChannel(`LibDB:${this.#name}`);
      this.#channel.onmessage = (event) => {
        const detail = event.data;
        if (
          !detail ||
          detail.type !== "change" ||
          detail.database !== this.#name ||
          detail.source === CONTEXT_ID
        ) return;
        this.#dispatch("change", detail);
      };
    } catch (error) {
      console.warn("LibDB: BroadcastChannelを利用できません。", error);
    }
  }

  #dispatch(type, detail) {
    for (const listener of this.#listeners.get(type) || []) {
      try {
        listener(detail);
      } catch (error) {
        console.error("LibDB event listener failed:", error);
      }
    }
  }

  #broadcastChange(change) {
    const detail = {
      type: "change",
      database: this.#name,
      source: CONTEXT_ID,
      store: change.store ?? null,
      stores: change.stores ?? (change.store ? [change.store] : []),
      operation: change.operation || "transaction",
      ...(change.diff ? { diff: change.diff } : {}),
      timestamp: Date.now()
    };

    // Notify every LibDB connection for this database in the current page.
    // BroadcastChannel does not deliver a message back to its sending context.
    for (const connection of Database.#connections.get(this.#name) || []) {
      connection.#dispatch("change", detail);
    }

    // Notify other tabs/windows. Local listeners are handled above.
    this.#channel?.postMessage(detail);
  }

  on(type, callback) {
    if (typeof type !== "string" || !type) {
      throw new TypeError("イベント名は空でない文字列で指定してください");
    }
    if (typeof callback !== "function") {
      throw new TypeError("callbackは関数で指定してください");
    }

    let listeners = this.#listeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.#listeners.set(type, listeners);
    }
    listeners.add(callback);

    return () => this.off(type, callback);
  }

  off(type, callback) {
    const listeners = this.#listeners.get(type);
    if (!listeners) return;
    listeners.delete(callback);
    if (listeners.size === 0) this.#listeners.delete(type);
  }

  #open() {
    if (this.#opening) return this.#opening;

    if (this.#ver === "auto") {
      this.#opening = this.#openAuto().then((db) => {
        this.#db = db;
        this.#setupChannel();
        let connections = Database.#connections.get(this.#name);
        if (!connections) {
          connections = new Set();
          Database.#connections.set(this.#name, connections);
        }
        connections.add(this);
        this.#db.onversionchange = (event) => {
          this.#db?.close();
          this.#db = null;
          const current = Database.#connections.get(this.#name);
          current?.delete(this);
          if (current?.size === 0) Database.#connections.delete(this.#name);
          this.#dispatch("versionchange", {
            database: this.#name,
            oldVersion: event.oldVersion,
            newVersion: event.newVersion
          });
        };
        return this;
      }).catch((error) => {
        throw new LibDBError("OPEN_FAILED", "DBの接続または自動アップグレードに失敗しました", error);
      }).finally(() => {
        this.#opening = null;
      });
      this.ready = this.#opening;
      return this.#opening;
    }

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
          this.#applyStoreDefinitions(db, upgradeTx);
        } catch (err) {
          upgradeError = err;
          upgradeTx.abort();
        }
      };

      req.onsuccess = (e) => {
        this.#db = e.target.result;
        this.#setupChannel();
        let connections = Database.#connections.get(this.#name);
        if (!connections) {
          connections = new Set();
          Database.#connections.set(this.#name, connections);
        }
        connections.add(this);
        this.#db.onversionchange = (event) => {
          // A version upgrade invalidates this IndexedDB connection, but the
          // BroadcastChannel must remain open so this tab can still receive
          // change notifications from the tab performing the upgrade.
          this.#db?.close();
          this.#db = null;

          const connections = Database.#connections.get(this.#name);
          connections?.delete(this);
          if (connections?.size === 0) Database.#connections.delete(this.#name);

          this.#dispatch("versionchange", {
            database: this.#name,
            oldVersion: event.oldVersion,
            newVersion: event.newVersion
          });
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

  async transaction(storeNames, mode, callback, change = null) {
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
          if (mode === "readwrite") {
            const names = Array.isArray(storeNames) ? storeNames : [storeNames];
            this.#broadcastChange(change || {
              stores: names,
              operation: "transaction"
            });
          }
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

  async execute(storeName, mode, operation, operationName = "transaction", diffInfo = null) {
    let requests;
    const results = [];
    const change = mode === "readwrite"
      ? { store: storeName, operation: operationName }
      : null;

    await this.transaction(storeName, mode, (stores) => {
      const store = stores[storeName];
      const trackDiff = Boolean(Database.diff && diffInfo);
      const changes = [];

      const getPathValue = (value, path) => {
        if (typeof path !== "string" || !path) return undefined;
        return path.split(".").reduce((current, part) => current?.[part], value);
      };

      if (trackDiff && diffInfo.type === "clear") {
        const beforeRequest = store.getAll();
        beforeRequest.onsuccess = () => {
          changes.splice(0, changes.length, ...beforeRequest.result.map((before) => ({
            key: getPathValue(before, store.keyPath),
            before,
            after: null
          })));
        };
      } else if (trackDiff) {
        for (const item of diffInfo.items || []) {
          const key = item.key !== undefined
            ? item.key
            : getPathValue(item.value, store.keyPath);
          const entry = { key, before: null, after: null, value: item.value };
          changes.push(entry);
          if (key !== undefined && diffInfo.type !== "add") {
            const beforeRequest = store.get(key);
            beforeRequest.onsuccess = () => {
              entry.before = beforeRequest.result ?? null;
            };
          }
        }
      }

      requests = operation(store);
      const list = Array.isArray(requests) ? requests : [requests];

      for (const [index, req] of list.entries()) {
        if (!req || typeof req !== "object" || !("onsuccess" in req)) {
          throw new TypeError("operationはIDBRequestまたはその配列を返す必要があります");
        }
        const originalSuccess = req.onsuccess;
        req.onsuccess = (event) => {
          results[index] = req.result;
          if (typeof originalSuccess === "function") originalSuccess.call(req, event);

          if (!trackDiff) return;
          if (diffInfo.type === "clear") {
            change.diff = changes;
            return;
          }

          const entry = changes[index];
          if (!entry) return;
          if (diffInfo.type === "delete") {
            entry.after = null;
            return;
          }

          const key = entry.key !== undefined ? entry.key : req.result;
          entry.key = key;
          if (key === undefined) {
            entry.after = entry.value ?? null;
            return;
          }

          const afterRequest = store.get(key);
          afterRequest.onsuccess = () => {
            entry.after = afterRequest.result ?? null;
          };
        };
      }

      if (trackDiff && diffInfo.type === "clear") {
        // The getAll request is queued before clear(), so its result is the
        // complete pre-clear snapshot.
        change.diff = changes;
      } else if (trackDiff) {
        change.diff = changes;
      }
    }, change);

    return Array.isArray(requests) ? results : results[0];
  }

  close() {
    this.#db?.close();
    this.#db = null;
    this.#channel?.close();
    this.#channel = null;

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
