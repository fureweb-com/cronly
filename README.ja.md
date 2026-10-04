# Cronly

[![npm version](https://img.shields.io/npm/v/%40fureweb%2Fcronly?logo=npm)](https://www.npmjs.com/package/@fureweb/cronly)
[![npm downloads](https://img.shields.io/npm/dm/%40fureweb%2Fcronly?logo=npm)](https://www.npmjs.com/package/@fureweb/cronly)
[![license](https://img.shields.io/github/license/fureweb-com/cronly)](https://github.com/fureweb-com/cronly/blob/main/LICENSE)
[![tests](https://github.com/fureweb-com/cronly/actions/workflows/ci.yml/badge.svg)](https://github.com/fureweb-com/cronly/actions/workflows/ci.yml)
[![coverage](https://codecov.io/github/fureweb-com/cronly/graph/badge.svg?branch=main)](https://app.codecov.io/github/fureweb-com/cronly)
[![stars](https://img.shields.io/github/stars/fureweb-com/cronly?style=social)](https://github.com/fureweb-com/cronly/stargazers)

スクリプトをかんたんに予約実行できます — cron 構文は不要です。
毎日8時、平日9時、4時間ごとのように、やりたいことをそのまま指定できます。
必要なら cron expression も直接使え、内部では crontab に安全に登録して管理します。

[English](./README.md) | [한국어](./README.ko.md) | **[日本語](./README.ja.md)** | [中文](./README.zh.md)

## 1分でわかる使い方

```bash
# 毎日 8:00 に実行
cronly add ./daily-report.mjs --daily 08:00
# 同じ意味の cron expression
cronly add ./daily-report.mjs --schedule "0 8 * * *"

# 平日 9:00 に実行
cronly add ./notify.mjs --weekdays --at 09:00
# 同じ意味の cron expression
cronly add ./notify.mjs --schedule "0 9 * * 1-5"

# 4 時間ごとに実行
cronly add ./sync.mjs --every-hours 4
# 同じ意味の cron expression
cronly add ./sync.mjs --schedule "0 */4 * * *"

# 毎週土曜 0:00 に実行
cronly add ./weekly-cleanup.mjs --weekly sat --at 00:00
# 同じ意味の cron expression
cronly add ./weekly-cleanup.mjs --schedule "0 0 * * 6"

# このツールが管理している項目を確認
cronly list
```

こんなときに向いています：

- `--daily`、`--weekdays`、`--every-hours` のような直感的なフラグでスクリプトを予約したい
- cron 構文を覚えなくても日常的なスケジュールを設定したい
- 複雑なケースでは cron expression を直接使いたい（`--schedule "0 */6 * * 1-3"`）
- 既存の crontab の他エントリは触りたくない
- 同じファイルを再登録してスケジュールだけ更新したい

## なぜ必要か？

`crontab -e` で手動管理すると、以下の問題が発生します：

- 同じスクリプトを誤って二重登録
- どのエントリがどのスクリプトか一目で把握しづらい
- 登録・修正・削除時に他の cron エントリを誤って変更するリスク
- スクリプトパス変更時に crontab の同期漏れ

**Cronly** はこれらを解決します：

| 手動 crontab 管理 | Cronly |
|---|---|
| 重複登録の可能性あり | 同じファイルなら自動 dedupe（シンボリックリンク、大文字小文字の違いを含む） |
| 他エントリの誤編集リスク | 管理ブロックのみ隔離して修正 |
| エントリの識別が困難 | メタデータコメントで識別 |
| 変更時に手動同期が必要 | `add` が upsert として動作 |

## 特徴

- 外部 npm dependency ゼロ — Node.js 組み込みモジュールのみ使用
- DB、サーバー、daemon 不要 — 実際の crontab が source of truth
- 管理エントリにメタデータコメントを付与し、既存の手動エントリと完全に隔離
- スペース、シングルクォート、`%` を含むパスを安全にシェルクォート処理
- ジョブはスクリプトのあるディレクトリで実行され、出力は `~/.cronly/logs/<id>.log` に残ります
- cron エイリアス対応（`@reboot`、`@daily`、`@weekly` など）
- ESM ベース（`"type": "module"`）
- Node.js >= 14.8.0

## インストール

```bash
# npm からインストール
npm install -g @fureweb/cronly

# インストールせずに使用
npx @fureweb/cronly

# ローカル開発
git clone https://github.com/fureweb-com/cronly.git
cd cronly
npm link
```

グローバルインストール後の実行コマンドは `cronly` です。

## 使い方

### スクリプトの登録

```bash
# 毎日 2:00 に実行
cronly add ./backup.sh --daily 02:00

# 10 分ごとに実行
cronly add ./report.mjs --every-minutes 10

# 月・水・金の 9:00 に実行
cronly add ./class.mjs --days mon,wed,fri --at 09:00

# 週末 10:00 に実行
cronly add ./weekend-job.mjs --weekends --at 10:00

# 起動時に 1 回実行
cronly add ./startup.sh --reboot

# ランタイム明示
cronly add ./custom-binary --daily 08:00 --runtime exec
```

`--runtime` には他のインタプリタの名前やパスも指定できます（例: `--runtime python3`）。`add` 時に絶対パスに解決して記録するため、cron からも見つかります。オプションは `--daily 08:00` と `--daily=08:00` のどちらの形でも書けます。

同じファイルを再度 `add` すると、**追加ではなく更新**として動作します：

```bash
# 初回：登録
cronly add ./backup.sh --daily 02:00

# 再度：スケジュール変更（重複登録なし）
cronly add ./backup.sh --daily 03:00
```

### かんたんスケジュールパターン

| フラグ | 例 | cron 変換結果 |
|--------|-----|--------------|
| `--daily HH:MM` | `--daily 08:00` | `0 8 * * *` |
| `--every-hours N` | `--every-hours 4` | `0 */4 * * *` |
| `--every-minutes N` | `--every-minutes 10` | `*/10 * * * *` |
| `--weekly 曜日 --at HH:MM` | `--weekly mon --at 10:00` | `0 10 * * 1` |
| `--days 曜日,... --at HH:MM` | `--days mon,wed,fri --at 09:00` | `0 9 * * 1,3,5` |
| `--weekdays --at HH:MM` | `--weekdays --at 08:30` | `30 8 * * 1-5` |
| `--weekends --at HH:MM` | `--weekends --at 10:00` | `0 10 * * 0,6` |
| `--reboot` | `--reboot` | `@reboot` |

曜日トークン: `sun`, `mon`, `tue`, `wed`, `thu`, `fri`, `sat`（大文字小文字不問）

`--every-hours` は 1, 2, 3, 4, 6, 8, 12、`--every-minutes` は 1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30 を受け付けます。cron は `*/N` を毎日（時間）または毎時（分）数え直すため、それ以外の値は等間隔に繰り返されません。それでも必要な場合は `--schedule` を使ってください。

### Cron expression 直接入力（上級者向け）

上記パターンでは表現できない場合、`--schedule` で直接指定できます：

```bash
# 月〜水曜に 6 時間ごと
cronly add ./report.mjs --schedule "0 */6 * * 1-3"

# 毎月 15 日 9:00
cronly add ./monthly.mjs --schedule "0 9 15 * *"
```

### 一覧表示

```bash
cronly list
```

出力例：
```
  a1b2c3d4  0 2 * * *        /home/user/backup.sh      (sh)
  e5f6a7b8  */10 * * * *     /home/user/report.mjs     (node)
```

### 削除

```bash
# ファイルパスで削除
cronly remove ./backup.sh

# id で削除
cronly remove --id a1b2c3d4
```

### Raw 出力

```bash
cronly print
```

管理中のエントリの実際の crontab ブロックを出力します。

### 環境チェック

```bash
cronly doctor
```

Node.js バージョン、`crontab` コマンド、crontab の読み取り権限、各管理エントリのスクリプト・ランタイム・ログディレクトリが存在するか、同じファイルが二重に登録されていないかを点検します。1つでも失敗すると終了コード 1 で終わります。

### macOS の許可ダイアログ

macOS では、フルディスクアクセスのないアプリが crontab を変更すると許可ダイアログが表示され、`cronly add` と `cronly remove` は応答があるまで待機します。ダイアログは他のウインドウの後ろに隠れることがあるため、数秒以上かかると案内を表示します。ダイアログなしで使うには、Cronly を実行するアプリにフルディスクアクセスを許可してください（システム設定 > プライバシーとセキュリティ > フルディスクアクセス）。

## スケジュールされたジョブの実行方法

cron は最小限の環境でジョブを起動するため、ターミナルでは動くスクリプトが cron では黙って失敗しがちです。Cronly は手動実行に近い形で動くよう、各ジョブを設定します。

- **作業ディレクトリ**: スクリプトのあるディレクトリで実行します。`.env` や `./config.json` のような相対パスがそのまま使えます。
- **PATH**: `cronly add` を実行した Node.js のディレクトリを先頭に置き、`/usr/bin:/bin` を続けます。シェルスクリプトから `node`、`npm`、`npx` を呼び出せます。それ以外のツールは絶対パスで呼ぶか、スクリプト内で `PATH` を設定してください。
- **ログ**: stdout と stderr を `~/.cronly/logs/<id>.log` に追記します。`CRONLY_HOME` で基準ディレクトリを変更できます。ログのローテーションはしません。
- **Node.js バージョン**: ジョブは登録時の Node.js 実行ファイルでそのまま実行されます（例: nvm のバージョン別ディレクトリ）。そのバージョンを削除すると `cronly doctor` が知らせるので、`cronly add` を再実行して現在のバージョンに切り替えてください。

以前のバージョンの Cronly で登録したエントリは、`cronly add` を再実行するまで以前のコマンド形式のままです。

## 重複登録防止の仕組み

1. スクリプトファイルの**絶対パス**を正規化（`path.resolve`）
2. 絶対パスの **SHA-256 ハッシュの先頭8文字**を dedupe id として使用
3. `add` 時に同じ id のブロックと、同じファイルを指すブロック（同じ inode。シンボリックリンクや macOS での大文字小文字の違いなど）を**置換**（upsert）
4. なければ**追加**

cron は `add` に渡したパスをそのまま実行するため、`current -> releases/v2` のようなシンボリックリンクによるデプロイ構成でも、リンクをたどり続けます。`remove <file>` はそのファイルのエントリをすべて削除します。

### crontab 内部形式

```crontab
# 既存の手動エントリ（変更なし）
0 * * * * /usr/bin/some-other-job

# [cronly:begin] id=a1b2c3d4 path=/home/user/backup.sh runtime=sh
0 2 * * * cd '/home/user' && PATH='/usr/local/bin:/usr/bin:/bin' '/bin/sh' '/home/user/backup.sh' >> '/home/user/.cronly/logs/a1b2c3d4.log' 2>&1
# [cronly:end] id=a1b2c3d4
```

`# [cronly:begin]` / `# [cronly:end]` ブロックで囲み、他の手動エントリと完全に隔離します。

## テスト

```bash
npm test
```

## プロジェクト構造

```
├── bin/cronly.mjs             # CLI エントリポイント
├── lib/
│   ├── cli.mjs                # argv パース
│   ├── commands.mjs           # add/list/remove/print/doctor 実装
│   ├── crontab.mjs            # crontab 読み書き（child_process）
│   ├── entry.mjs              # エントリ生成/パース/dedupe
│   ├── schedule.mjs           # スケジュールフラグ → cron 式の変換
│   ├── i18n.mjs               # 言語検出、メッセージ取得
│   └── i18n/                  # メッセージとヘルプ（en, ko, ja, zh）
├── test/
│   ├── test.mjs               # ユニットテスト
│   └── integration.mjs        # 統合テスト（実際の crontab）
├── package.json
└── LICENSE
```

## 今後の拡張ポイント

- **dry-run モード**: `--dry-run` フラグで実際の crontab を変更せずにプレビュー
- **import/export**: 管理エントリを JSON でバックアップ/復元
- **ログオプション**: ログパスの指定、ログローテーション
- **環境変数注入**: cron 実行時の任意の環境変数設定
- **MAILTO 設定**: エントリごとのエラー通知メール設定
- **グループ/タグ**: エントリをグループ化して一括管理
- **overlap 防止**: flock ベースの同時実行防止ラッピング

## 制約事項

- user crontab のみ対応（`crontab -l` / `crontab -`）
- systemd timer、`/etc/cron.d` 非対応
- 分散環境非対応（単一マシン前提）
- overlap execution 防止なし
- ログはローテーションなしで追記され続けます
- 999 バイトを超える cron コマンドは拒否します（Vixie 系 cron が切り捨てるため）
- 改行または carriage return を含むパスは非対応

## ライセンス

MIT
