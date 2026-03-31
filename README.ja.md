# crontab-agent

`crontab -e` を直接開かずに、スクリプトを cron に登録するためのツールです。
ファイルを1つ登録し、今何が入っているかを確認し、不要になったらあとで削除できます。

[English](./README.md) | [한국어](./README.ko.md) | **[日本語](./README.ja.md)** | [中文](./README.zh.md)

## 1分でわかる使い方

```bash
# このスクリプトを10分ごとに実行
crontab-agent add ./report.mjs --schedule "*/10 * * * *"

# このツールが管理している項目を確認
crontab-agent list

# あとで削除
crontab-agent remove ./report.mjs
```

こんなときに向いています：

- Node.js スクリプトやシェルスクリプトを cron で実行したい
- 既存の crontab の他エントリは触りたくない
- 同じファイルを再登録してスケジュールだけ更新したい

## なぜ必要か？

`crontab -e` で手動管理すると、以下の問題が発生します：

- 同じスクリプトを誤って二重登録
- どのエントリがどのスクリプトか一目で把握しづらい
- 登録・修正・削除時に他の cron エントリを誤って変更するリスク
- スクリプトパス変更時に crontab の同期漏れ

**crontab-agent** はこれらを解決します：

| 手動 crontab 管理 | crontab-agent |
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
npm install -g crontab-agent

# インストールせずに使用
npx crontab-agent

# ローカル開発
git clone https://github.com/fureweb/crontab-agent.git
cd crontab-agent
npm link
```

## 使い方

### スクリプトの登録

```bash
# .sh ファイル → ランタイム自動推論（sh）
crontab-agent add ./backup.sh --schedule "0 2 * * *"

# .mjs ファイル → ランタイム自動推論（node）
crontab-agent add ./report.mjs --schedule "*/10 * * * *"

# ランタイム明示
crontab-agent add ./custom-binary --schedule "0 * * * *" --runtime exec

# cron エイリアス
crontab-agent add ./startup.sh --schedule "@reboot"
```

同じファイルを再度 `add` すると、**追加ではなく更新**として動作します：

```bash
# 初回：登録
crontab-agent add ./backup.sh --schedule "0 2 * * *"

# 再度：スケジュール変更（重複登録なし）
crontab-agent add ./backup.sh --schedule "0 3 * * *"
```

### 一覧表示

```bash
crontab-agent list
```

出力例：
```
  a1b2c3d4  0 2 * * *        /home/user/backup.sh      (sh)
  e5f6a7b8  */10 * * * *     /home/user/report.mjs     (node)
```

### 削除

```bash
# ファイルパスで削除
crontab-agent remove ./backup.sh

# id で削除
crontab-agent remove --id a1b2c3d4
```

### Raw 出力

```bash
crontab-agent print
```

管理中のエントリの実際の crontab ブロックを出力します。

### 環境チェック

```bash
crontab-agent doctor
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

# [crontab-agent:begin] id=a1b2c3d4 path=/home/user/backup.sh runtime=sh
0 2 * * * '/bin/sh' '/home/user/backup.sh'
# [crontab-agent:end] id=a1b2c3d4
```

`# [crontab-agent:begin]` / `# [crontab-agent:end]` ブロックで囲み、他の手動エントリと完全に隔離します。

## テスト

```bash
npm test
```

## プロジェクト構造

```
├── bin/crontab-agent.mjs      # CLI エントリポイント
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
