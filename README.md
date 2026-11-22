# LibDB

シンプルなIndexedDBラッパーライブラリです。

## 接続

```js
import { LibDB, LibDBError } from "https://cdn.jsdelivr.net/gh/YSAS4331/LibDB@main/src/index.js";

const db = new LibDB("ExampleDB", 1, {
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

## 別タブからの変更通知

BroadcastChannelに対応したブラウザでは、同じDBを開いている別タブからLibDB経由でデータが変更されると通知を受け取れます。

```js
const unsubscribe = db.on("change", (event) => {
  console.log(event);
  // {
  //   type: "change",
  //   database: "ExampleDB",
  //   store: "users",
  //   stores: ["users"],
  //   operation: "put",
  //   timestamp: 123456789
  // }
});

// 通知が不要になったら解除
unsubscribe();
// または db.off("change", callback)
```

通知対象は、成功したreadwriteトランザクションです。Store APIの操作では `add`、`put`、`bulkAdd`、`bulkPut`、`delete`、`bulkDelete`、`clear` を識別します。複数ストアの `db.transaction()` は `operation: "transaction"` として通知します。

通知は別タブ・同一オリジン間でBroadcastChannelを通じて送られます。BroadcastChannel非対応環境では通知機能は利用できません。また、IndexedDBを直接操作した場合や、別のIndexedDBラッパーによる変更は検知できません。

### 変更差分（diff）

変更通知には、デフォルトでレコード単位の変更前後データが含まれます。

```js
db.on("change", (event) => {
  console.log(event.diff);
  // [
  //   {
  //     key: 1,
  //     before: { id: 1, name: "Taro", score: 100 },
  //     after: { id: 1, name: "Taro", score: 120 }
  //   }
  // ]
});
```

`diff` は追加・更新・削除・全件削除を対象にします。追加時の `before` は `null`、削除時の `after` は `null` です。差分の追跡が不要な場合は、接続前または接続後に静的プロパティで無効化できます。

```js
LibDB.diff = false; // 以降の変更通知ではdiffを作成しない
LibDB.diff = true;  // 再び有効化
```

無効化しても変更通知自体（operation、store、timestampなど）は引き続き送信されます。diffは成功した書き込みトランザクションについてのみ通知されます。

## データベースの削除

データベース自体を削除するには、静的メソッド `LibDB.delete(name)` を使用します。

```js
await LibDB.delete("ExampleDB");
```

同じLibDBインスタンスが保持している接続は削除前に自動で閉じます。他のタブや別のコードが開いている接続が残っている場合、削除は `blocked` になることがあります。ブロック中は接続が閉じられるまでPromiseは完了しません。

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

一括操作には保存するデータや削除するキーを配列で渡します。

```js
await users.bulkPut([
  { id: 1, name: "Taro" },
  { id: 2, name: "Hanako" }
]);

await users.bulkAdd([
  { id: 3, name: "Jiro" }
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
