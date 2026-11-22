# LibDB

シンプルなIndexedDBラッパーライブラリです。

## 接続

```js
import { LibDB, LibDBError } from "https://cdn.jsdelivr.net/gh/YSAS4331/LibDB@main/src/index.js";

const db = new LibDB("UsefulTools", 1, {
  users: {
    keyPath: "id",
    autoIncrement: true,
    indexes: [
      { name: "byName", keyPath: "name", options: { unique: false } }
    ]
  }
});

await db.ready;
const users = db.store("users");
```

従来の `{ users: "id" }` という文字列形式も引き続き利用できます。

## Store API

| API | 説明 |
| --- | --- |
| `add(value, key?)` | レコードを追加 |
| `put(value, key?)` | レコードを追加または置き換え |
| `bulkAdd(items)` | 複数レコードを1トランザクションで追加 |
| `bulkPut(items)` | 複数レコードを1トランザクションで追加・置き換え |
| `bulkDelete(keys)` | 複数キーを1トランザクションで削除 |
| `get(key)` | キーで取得 |
| `getAll(query?, count?)` | 複数レコードを取得 |
| `getAllKeys(query?, count?)` | キー一覧を取得 |
| `count(query?)` | 件数を取得 |
| `delete(key)` | 1件削除 |
| `clear()` | 全件削除 |
| `index(name)` | インデックス操作用オブジェクトを取得 |

### 第2引数のキー

`keyPath` を設定していないストアでは、キーを外から指定できます。

```js
await db.store("logs").add({ message: "hello" }, "log-1");
await db.store("logs").put({ message: "updated" }, "log-1");
```

`keyPath` が設定されたストアに第2引数のキーを渡すことはできません（IndexedDBの仕様）。

### 一括操作

一括操作の各要素は `{ value, key? }` 形式です。

```js
await users.bulkPut([
  { value: { id: 1, name: "Taro" } },
  { value: { id: 2, name: "Hanako" } }
]);

await users.bulkAdd([
  { value: { id: 3, name: "Jiro" } }
]);

await users.bulkDelete([1, 2]);
```

一括操作は1つのreadwriteトランザクションで実行され、途中で失敗するとトランザクション全体が中止されます。

## Index API

```js
const byName = users.index("byName");

const user = await byName.get("Taro");
const matches = await byName.getAll("Taro");
const total = await byName.count("Taro");
```

## 複数ストアのトランザクション

callbackには、ストア名をキーにしたネイティブの `IDBObjectStore` の辞書と、`IDBTransaction` が渡されます。

```js
await db.transaction(["users", "logs"], "readwrite", (stores, tx) => {
  stores.users.put({ id: 1, name: "Taro" });
  stores.logs.add({ message: "user updated" });
});
```

IndexedDBの仕様上、callbackは同期関数にしてください。callback内で `await` は使用できません。

## エラー

操作時のエラーは `LibDBError` に正規化されます。

- `OPEN_FAILED`: データベース接続失敗
- `QUOTA_EXCEEDED`: 保存容量超過
- `TX_FAILED`: トランザクション失敗
