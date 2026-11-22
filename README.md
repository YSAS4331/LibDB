# LibDB

IndexedDBをシンプルに扱うための軽量ラッパーライブラリです。接続・Store操作・Index検索・トランザクションに加え、データ変更の通知と変更差分の取得に対応しています。

## 特徴

- Promiseベースのデータベース接続とStore API
- Store・Indexの定義と取得
- 複数レコードの一括操作
- 複数Storeをまとめたトランザクション
- 同一ページ内のLibDBインスタンス間での変更通知
- BroadcastChannelを利用した別タブへの変更通知
- レコード単位の変更差分（diff）
- エラーのLibDBErrorへの正規化

## 目次

- [インストール](#インストール)
- [クイックスタート](#クイックスタート)
- [データベース接続とStore定義](#データベース接続とstore定義)
- [Store API](#store-api)
- [Index API](#index-api)
- [トランザクション](#トランザクション)
- [イベントと変更通知](#イベントと変更通知)
- [変更差分（diff）](#変更差分diff)
- [接続管理とデータベース削除](#接続管理とデータベース削除)
- [エラー処理](#エラー処理)
- [仕様・制限事項](#仕様制限事項)

## インストール

ES Modulesとして読み込みます。npmなどのパッケージマネージャーを使わずに利用する場合は、jsDelivrから読み込めます。

~~~js
import { LibDB, LibDBError } from "https://cdn.jsdelivr.net/gh/YSAS4331/LibDB@main/libdb.min.js";
~~~

## クイックスタート

データベースに接続し、Storeからデータを追加・取得する基本的な例です。

~~~js
import { LibDB } from "https://cdn.jsdelivr.net/gh/YSAS4331/LibDB@main/libdb.min.js";

const db = new LibDB("ExampleDB", 1, {
  users: {
    keyPath: "id",
    autoIncrement: true
  }
});

await db.ready;

const users = db.store("users");

const id = await users.add({
  name: "Taro",
  score: 100
});

const user = await users.get(id);
console.log(user);
~~~

## データベース接続とStore定義

new LibDB(name, version?, stores?)でデータベースに接続します。接続処理は非同期で行われ、db.readyをawaitすると接続完了を待機できます。

~~~js
const db = new LibDB("ExampleDB", 1, {
  users: {
    keyPath: "id",
    autoIncrement: true,
    indexes: [
      { name: "byName", keyPath: "name", options: { unique: false } }
    ]
  },
  logs: "id",
  settings: ["category", "id"]
});

await db.ready;
~~~

Store定義には次の形式を指定できます。

| 定義 | 説明 |
| --- | --- |
| "id" | keyPathを指定する簡易形式 |
| ["category", "id"] | 複合keyPath |
| { keyPath, autoIncrement, indexes } | オプションを含む詳細形式 |

詳細形式のindexesには配列を指定します。各要素にはname、keyPath、必要に応じてoptionsを指定します。

接続時のアップグレード処理では、定義に含まれる不足StoreやIndexが作成されます。

## Store API

db.store(name)でStoreオブジェクトを取得します。各メソッドはPromiseを返します。

| メソッド | 説明 |
| --- | --- |
| add(value, key?) | レコードを追加 |
| put(value, key?) | レコードを追加、または既存レコードを置き換え |
| bulkAdd(items) | 複数レコードを一括追加 |
| bulkPut(items) | 複数レコードを一括追加・置き換え |
| bulkDelete(keys) | 複数キーのレコードを一括削除 |
| get(key) | キーを指定して1件取得 |
| getAll(query?, count?) | レコードを複数取得 |
| getAllKeys(query?, count?) | キーを複数取得 |
| count(query?) | レコード数を取得 |
| delete(key) | キーを指定して1件削除 |
| clear() | Store内の全レコードを削除 |
| index(name) | Indexオブジェクトを取得 |

### 基本操作

~~~js
const users = db.store("users");

await users.add({ name: "Taro", score: 100 });
await users.put({ id: 1, name: "Taro", score: 120 });

const user = await users.get(1);
const allUsers = await users.getAll();
const total = await users.count();

await users.delete(1);
~~~

addはキーが重複すると失敗します。putは同じキーのレコードが存在すれば置き換え、存在しなければ追加します。

### キーを明示する

インラインキー（keyPath）を設定していないStoreでは、第2引数でキーを指定できます。

~~~js
const logs = db.store("logs");

await logs.add({ message: "hello" }, "log-1");
await logs.put({ message: "updated" }, "log-1");
~~~

keyPathを設定したStoreでは、第2引数のキーは指定できません。これはIndexedDBの仕様です。

### 一括操作

一括操作には配列を渡します。各操作は1つのreadwriteトランザクションで実行され、途中で失敗するとトランザクション全体が中止されます。

~~~js
await users.bulkAdd([
  { id: 1, name: "Taro" },
  { id: 2, name: "Hanako" }
]);

await users.bulkPut([
  { id: 1, name: "Taro", score: 150 },
  { id: 2, name: "Hanako", score: 200 }
]);

await users.bulkDelete([1, 2]);
~~~

空配列を渡した一括操作は、空配列を返して終了します。

## Index API

Storeに定義したIndexはstore.index(name)で取得します。

| メソッド | 説明 |
| --- | --- |
| get(key) | Indexキーに一致する最初のレコードを取得 |
| getAll(query?, count?) | 一致するレコードを複数取得 |
| count(query?) | 一致するレコード数を取得 |

~~~js
const byName = users.index("byName");

const user = await byName.get("Taro");
const matches = await byName.getAll("Taro");
const total = await byName.count("Taro");
~~~

## トランザクション

db.transaction(storeNames, mode, callback)を使うと、複数Storeへの操作を1つのトランザクションとして実行できます。

callbackには、Store名をキーにしたネイティブのIDBObjectStoreの辞書と、IDBTransactionが渡されます。

~~~js
await db.transaction(["users", "logs"], "readwrite", (stores, tx) => {
  stores.users.put({ id: 1, name: "Taro" });
  stores.logs.add({ message: "user updated" });
});
~~~

IndexedDBの仕様上、callbackは同期関数にしてください。callback内でawaitは使用できません。

## イベントと変更通知

LibDBはデータベースの変更をchangeイベントとして通知します。通知は次の範囲に配信されます。

- **同一ページ内:** 同じDB名で接続しているLibDBインスタンスに直接通知
- **別タブ:** BroadcastChannelに対応した環境で、同じDBを開いている別タブに通知

### イベントを購読する

db.on(eventName, callback)でイベントを購読できます。changeイベントの購読解除には、戻り値の関数を利用できます。

~~~js
const unsubscribe = db.on("change", (event) => {
  console.log("データベースが変更されました", event);
});

// 購読解除
unsubscribe();
~~~

コールバックを指定して解除することもできます。

~~~js
const callback = (event) => {
  console.log(event);
};

db.on("change", callback);
db.off("change", callback);
~~~

### changeイベントのデータ

イベントには主に次の情報が含まれます。

| プロパティ | 内容 |
| --- | --- |
| type | イベント種別（"change"） |
| database | データベース名 |
| source | 通知元の実行コンテキスト識別子 |
| store | 対象Store名。複数Storeの場合はnull |
| stores | 対象Store名の配列 |
| operation | 操作名 |
| timestamp | 通知時刻（Unixミリ秒） |
| diff | diff有効時に含まれる変更前後のデータ |

Store APIの書き込み操作では、add、put、bulkAdd、bulkPut、delete、bulkDelete、clearが操作名として通知されます。複数Storeのdb.transaction()ではoperation: "transaction"となります。

通知はトランザクションが正常に完了した後に送信されます。失敗・中止したトランザクションは通知されません。同一ページ内では、同じDB名で接続しているLibDBインスタンスに通知されます。別タブへの通知では、送信元の実行コンテキスト自身への重複通知は行われません。

## 変更差分（diff）

diffはデフォルトで有効です。changeイベントのevent.diffには、レコード単位の変更前後データが配列で格納されます。

各エントリーの形式：

~~~js
{
  key: 1,
  before: { id: 1, name: "Taro", score: 100 },
  after:  { id: 1, name: "Taro", score: 120 }
}
~~~

| プロパティ | 内容 |
| --- | --- |
| key | 対象レコードのキー |
| before | 操作前のレコード。新規追加時はnull |
| after | 操作後のレコード。削除時はnull |

操作ごとの値は次のとおりです。

| 操作 | before | after |
| --- | --- | --- |
| 新規追加 | null | 追加されたレコード |
| 更新・置き換え | 更新前のレコード | 更新後のレコード |
| 削除 | 削除前のレコード | null |
| 全件削除（clear） | 削除前の各レコード | null |

更新時は変更されたフィールドだけではなく、レコード全体が含まれます。

### diffを利用する

~~~js
db.on("change", (event) => {
  for (const item of event.diff ?? []) {
    console.log("key:", item.key);
    console.log("before:", item.before);
    console.log("after:", item.after);
  }
});
~~~

### diffの有効・無効を切り替える

静的プロパティLibDB.diffで切り替えます。接続前・接続後のどちらでも設定でき、LibDB全体に適用されます。

~~~js
LibDB.diff = false; // diffの生成を無効化
LibDB.diff = true;  // diffの生成を再び有効化
~~~

無効化しても変更通知自体は送信されますが、event.diffは含まれません。diffの取得には追加のIndexedDBリクエストが必要です。また、clear()は削除前の全レコードをdiffに含めるため、大量のデータがある場合はdiffを無効にすることをおすすめします。

diffの対象はStore APIの書き込み操作です。複数Storeのdb.transaction()はネイティブStoreを直接操作するため、現時点ではdiffの対象外です。

## 接続管理とデータベース削除

### 接続を閉じる

~~~js
db.close();
~~~

データベース接続と変更通知用BroadcastChannelを閉じます。切断後にDB操作を行うと、必要に応じて再接続されます。

### データベースを削除する

LibDB.delete(name)でデータベース自体を削除できます。Promiseが完了すると削除が完了しています。

~~~js
await LibDB.delete("ExampleDB");
~~~

LibDBが管理している同名DBの接続は、削除前に自動で閉じられます。他のタブやLibDB以外のコードが接続を開いている場合は削除がブロックされ、接続が閉じられるまでPromiseが完了しないことがあります。削除すると、そのDB内の全Storeと全レコードが失われます。

### バージョン変更を検知する

別の接続がDBのバージョンを上げると、古い接続はIndexedDBによって閉じられます。LibDBではversionchangeイベントを購読できます。

~~~js
db.on("versionchange", (event) => {
  console.log(event.oldVersion, event.newVersion);
});
~~~

## エラー処理

接続・操作時のエラーは、可能な範囲でLibDBErrorに正規化されます。

| コード | 内容 |
| --- | --- |
| OPEN_FAILED | データベース接続・オープン失敗 |
| QUOTA_EXCEEDED | 保存容量超過 |
| TX_FAILED | トランザクション失敗 |

LibDBErrorは必要に応じてimportして利用できます。

~~~js
import { LibDB, LibDBError } from "https://cdn.jsdelivr.net/gh/YSAS4331/LibDB@main/libdb.min.js";

try {
  await users.add({ name: "Taro" });
} catch (error) {
  if (error instanceof LibDBError) {
    console.error(error.code, error.message);
  }
}
~~~

## 仕様・制限事項

- LibDB経由で行われた変更を通知します。IndexedDBを直接操作した場合や、他のラッパー経由の変更は検知できません。
- 同一ページ内の変更通知はLibDB内部で直接配信されます。
- 別タブへの変更通知にはBroadcastChannelを使用します。BroadcastChannel非対応環境では別タブへの通知は利用できません。
- db.transaction()のcallback内ではawaitを使用できません。
- db.transaction()による複数Store操作は変更通知されますが、現時点ではdiffの対象外です。
- diffの生成には追加のIndexedDBリクエストが発生します。clear()で大量のレコードを削除する場合は、必要に応じてdiffを無効にしてください。
