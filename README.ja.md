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
| 重複登録の可能性あり | 絶対パス基準で自動 dedupe |
| 他エントリの誤編集リスク | 管理ブロックのみ隔離して修正 |
| エントリの識別が困難 | メタデータコメントで識別 |
| 変更時に手動同期が必要 | `add` が upsert として動作 |

## 特徴

- 外部 npm dependency ゼロ — Node.js 組み込みモジュールのみ使用
- DB、サーバー、daemon 不要 — 実際の crontab が source of truth
- 管理エントリにメタデータコメントを付与し、既存の手動エントリと完全に隔離
- スペース、シングルクォート、`%` を含むパスを安全にシェルクォート処理
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

Node.js バージョン、`crontab` コマンドの存在、crontab の読み取り可否を点検します。

## 重複登録防止の仕組み

1. スクリプトファイルの**絶対パス**を正規化（`path.resolve`）
2. 絶対パスの **SHA-256 ハッシュの先頭8文字**を dedupe id として使用
3. `add` 時に同じ id のブロックが既にあれば**置換**（upsert）
4. なければ**追加**

### crontab 内部形式

```crontab
# 既存の手動エントリ（変更なし）
0 * * * * /usr/bin/some-other-job

# [cronly:begin] id=a1b2c3d4 path=/home/user/backup.sh runtime=sh
0 2 * * * '/bin/sh' '/home/user/backup.sh'
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
│   ├── cli.mjs                # argv パース、ヘルプ
│   ├── commands.mjs           # add/list/remove/print/doctor 実装
│   ├── crontab.mjs            # crontab 読み書き（child_process）
│   └── entry.mjs              # エントリ生成/パース/dedupe
├── test/
│   ├── test.mjs               # ユニットテスト
│   └── integration.mjs        # 統合テスト（実際の crontab）
├── package.json
└── LICENSE
```

## 今後の拡張ポイント

- **dry-run モード**: `--dry-run` フラグで実際の crontab を変更せずにプレビュー
- **import/export**: 管理エントリを JSON でバックアップ/復元
- **ログパス自動設定**: `>> /path/to/log 2>&1` の自動付与オプション
- **環境変数注入**: cron 実行時の PATH 等の環境変数設定
- **MAILTO 設定**: エントリごとのエラー通知メール設定
- **グループ/タグ**: エントリをグループ化して一括管理
- **cron 式バリデーション**: schedule 値の事前検証
- **overlap 防止**: flock ベースの同時実行防止ラッピング

## 制約事項

- user crontab のみ対応（`crontab -l` / `crontab -`）
- systemd timer、`/etc/cron.d` 非対応
- 分散環境非対応（単一マシン前提）
- overlap execution 防止なし
- 改行または carriage return を含むパスは非対応

## ライセンス

MIT
