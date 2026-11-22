# LibDB

IndexedDBを扱いやすくする、軽量なラッパーライブラリです。データベース接続、Store操作、一括操作、複数ストアのトランザクション、同一ページ・別タブへの変更通知に対応しています。

## 目次

- [インストール・読み込み](#読み込み)
- [データベースへの接続](#データベースへの接続)
- [Store API](#store-api)
- [Index API](#index-api)
- [複数ストアのトランザクション](#複数ストアのトランザクション)
- [変更通知](#別タブへの変更通知)
- [変更差分（diff）](#変更差分diff)
- [データベースの削除と切断](#データベースの削除と切断)
- [エラー](#エラー)

## 読み込み

ES Modulesとして読み込みます。以下はjsDelivrから読み込む例です。

```js
import { LibDB, LibDBError } from "https://cdn.jsdelivr.net/gh/YSAS4331/LibDB@main/src/index.js";
```

## データベースへの接続

`new LibDB(name, version?, stores?)` で接続します。接続完了は `ready` で待機できます。

```js
const db = new LibDB("ExampleDB", 1, {
  users: {
    keyPath: "id",
    autoIncrement: true,
    indexes: [
      { name: "byName", keyPath: "name", options: { unique: false } }
    ]
  },
  logs: "id"
});

await db.ready;

const users = db.store("users");
```

Store定義には次の形式を指定できます。

- `"id"`: keyPathを指定する簡易形式
- `["category", "id"]`: 複合keyPathを指定する形式
- `{ keyPath, autoIncrement, indexes }`: 詳細な定義

オブジェクト形式の `indexes` は配列です。各要素に `name`、`keyPath`、必要に応じて `options` を指定します。既存Storeに対しては、接続時のアップグレード処理で不足しているStoreやIndexが作成されます。

## Store API

`db.store(name)` でStoreオブジェクトを取得します。各メソッドはPromiseを返します。

| メソッド | 説明 |
| --- | --- |
| `add(value, key?)` | レコードを追加 |
| `put(value, key?)` | レコードを追加、または既存レコードを置き換え |
| `bulkAdd(items)` | 複数レコードを一括追加 |
| `bulkPut(items)` | 複数レコードを一括追加・置き換え |
| `bulkDelete(keys)` | 複数キーのレコードを一括削除 |
| `get(key)` | キーを指定して1件取得 |
| `getAll(query?, count?)` | レコードを複数取得 |
| `getAllKeys(query?, count?)` | キーを複数取得 |
| `count(query?)` | レコード数を取得 |
| `delete(key)` | キーを指定して1件削除 |
| `clear()` | Store内の全レコードを削除 |
| `index(name)` | Indexオブジェクトを取得 |

### 基本操作

```js
await users.add({ name: "Taro", score: 100 });
await users.put({ id: 1, name: "Taro", score: 120 });

const user = await users.get(1);
const allUsers = await users.getAll();
const total = await users.count();

await users.delete(1);
```

`add` はキーが重複すると失敗します。`put` は同じキーのレコードがあれば置き換え、なければ追加します。

### キーを明示する場合

インラインキー（`keyPath`）を設定していないStoreでは、第2引数でキーを指定できます。

```js
const logs = db.store("logs");

await logs.add({ message: "hello" }, "log-1");
await logs.put({ message: "updated" }, "log-1");
```

`keyPath` を設定したStoreでは、第2引数のキーは指定できません。これはIndexedDBの仕様です。

### 一括操作

一括操作には配列を渡します。各操作は1つのreadwriteトランザクションで実行され、途中で失敗するとトランザクション全体が中止されます。

```js
await users.bulkAdd([
  { id: 1, name: "Taro" },
  { id: 2, name: "Hanako" }
]);

await users.bulkPut([
  { id: 1, name: "Taro", score: 150 },
  { id: 2, name: "Hanako", score: 200 }
]);

await users.bulkDelete([1, 2]);
```

空配列を渡した一括操作は、空配列を返して終了します。

## Index API

Storeに定義したIndexは `store.index(name)` で取得します。

| メソッド | 説明 |
| --- | --- |
| `get(key)` | Indexキーに一致する最初のレコードを取得 |
| `getAll(query?, count?)` | 一致するレコードを複数取得 |
| `count(query?)` | 一致するレコード数を取得 |

```js
const byName = users.index("byName");

const user = await byName.get("Taro");
const matches = await byName.getAll("Taro");
const total = await byName.count("Taro");
```

## 複数ストアのトランザクション

`db.transaction(storeNames, mode, callback)` で複数Storeを1つのトランザクションとして操作できます。callbackにはStore名をキーにしたネイティブの `IDBObjectStore` の辞書と、`IDBTransaction` が渡されます。

```js
await db.transaction(["users", "logs"], "readwrite", (stores, tx) => {
  stores.users.put({ id: 1, name: "Taro" });
  stores.logs.add({ message: "user updated" });
});
```

IndexedDBの仕様上、callbackは同期関数にしてください。callback内で `await` は使用できません。

## 同一ページ・別タブへの変更通知

同じページ内で同じDBを開いている別々のLibDBインスタンス間、およびBroadcastChannelに対応したブラウザの別タブ間で、LibDB経由の変更を `change` イベントとして受け取れます。同一ページ内の通知は内部で直接配信し、別タブへの通知にはBroadcastChannelを使用します。

```js
const unsubscribe = db.on("change", (event) => {
  console.log(event);
});

// 購読解除
unsubscribe();

// または
db.off("change", callback);
```

イベントには主に次の情報が含まれます。

| プロパティ | 内容 |
| --- | --- |
| `type` | イベント種別（`"change"`） |
| `database` | データベース名 |
| `source` | 通知元の実行コンテキスト識別子 |
| `store` | 対象Store名。複数Storeの場合は `null` |
| `stores` | 対象Store名の配列 |
| `operation` | 操作名 |
| `timestamp` | 通知時刻（Unixミリ秒） |
| `diff` | 有効時に含まれる変更前後のデータ |

Store APIでは `add`、`put`、`bulkAdd`、`bulkPut`、`delete`、`bulkDelete`、`clear` を識別します。複数Storeの `db.transaction()` は `operation: "transaction"` です。

通知はトランザクションが正常に完了した後に送信されます。失敗・中止したトランザクションは通知されません。同一ページ内では、同じDB名で接続しているすべてのLibDBインスタンスに通知されます。別タブへの通知では、送信元の実行コンテキスト自身には重複して通知されません。

BroadcastChannel非対応環境でも同一ページ内の通知は利用できますが、別タブへの通知は利用できません。また、IndexedDBを直接操作した場合や、他のラッパー経由の変更は検知できません。

## 変更差分（diff）

diffはデフォルトで有効です。変更通知の `event.diff` には、レコード単位の変更前後データが配列で格納されます。

各エントリーの形式：

```js
{
  key: 1,
  before: { id: 1, name: "Taro", score: 100 },
  after:  { id: 1, name: "Taro", score: 120 }
}
```

- `key`: 対象レコードのキー
- `before`: 操作前のレコード
- `after`: 操作後のレコード

操作ごとの値は次のとおりです。

| 操作 | `before` | `after` |
| --- | --- | --- |
| 新規追加 | `null` | 追加されたレコード |
| 更新・置き換え | 更新前のレコード | 更新後のレコード |
| 削除 | 削除前のレコード | `null` |
| 全件削除（clear） | 削除前の各レコード | `null` |

更新時も変更されたフィールドだけではなく、レコード全体が入ります。

### diffの利用例

```js
db.on("change", (event) => {
  for (const item of event.diff ?? []) {
    console.log("key:", item.key);
    console.log("before:", item.before);
    console.log("after:", item.after);
  }
});
```

### diffの有効・無効を切り替える

静的プロパティ `LibDB.diff` で切り替えます。接続前・接続後のどちらでも設定でき、LibDB全体に適用されます。

```js
LibDB.diff = false; // diffの生成を無効化
LibDB.diff = true;  // diffの生成を再び有効化
```

無効化しても変更通知自体は送信されますが、`event.diff` は含まれません。diffの取得には追加のIndexedDBリクエストが必要です。また、`clear()` は削除前の全レコードをdiffに含めるため、大量のデータがある場合はdiffを無効にすることをおすすめします。

diffの対象はStore APIの書き込み操作です。複数Storeの `db.transaction()` はネイティブStoreを直接操作するため、現時点ではdiffの対象外です。

## データベースの削除と切断

### データベースの削除

`LibDB.delete(name)` でデータベース自体を削除します。Promiseが完了すると削除が完了しています。

```js
await LibDB.delete("ExampleDB");
```

LibDBが管理している同名DBの接続は、削除前に自動で閉じられます。他のタブやLibDB以外のコードが接続を開いている場合は削除がブロックされ、接続が閉じられるまでPromiseが完了しないことがあります。削除すると、そのDB内の全Storeと全レコードが失われます。

### 接続の切断

```js
db.close();
```

接続と変更通知用BroadcastChannelを閉じます。切断後にDB操作を行うと、必要に応じて再接続されます。

### バージョン変更通知

別の接続がDBのバージョンを上げると、古い接続はIndexedDBによって閉じられます。LibDBでは `versionchange` イベントを受け取れます。

```js
db.on("versionchange", (event) => {
  console.log(event.oldVersion, event.newVersion);
});
```

## エラー

接続・操作時のエラーは、可能な範囲で `LibDBError` に正規化されます。

| コード | 内容 |
| --- | --- |
| `OPEN_FAILED` | データベース接続・オープン失敗 |
| `QUOTA_EXCEEDED` | 保存容量超過 |
| `TX_FAILED` | トランザクション失敗 |

`LibDBError` は必要に応じてimportして利用できます。

```js
import { LibDB, LibDBError } from "https://cdn.jsdelivr.net/gh/YSAS4331/LibDB@main/src/index.js";

try {
  await users.add({ name: "Taro" });
} catch (error) {
  if (error instanceof LibDBError) {
    console.error(error.code, error.message);
  }
}
```
