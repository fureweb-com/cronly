# Cronly 2.0.0

[![npm version](https://img.shields.io/npm/v/%40fureweb%2Fcronly?logo=npm)](https://www.npmjs.com/package/@fureweb/cronly)
[![license](https://img.shields.io/github/license/fureweb-com/cronly)](https://github.com/fureweb-com/cronly/blob/main/LICENSE)
[![tests](https://github.com/fureweb-com/cronly/actions/workflows/ci.yml/badge.svg)](https://github.com/fureweb-com/cronly/actions/workflows/ci.yml)
[![coverage](https://codecov.io/github/fureweb-com/cronly/graph/badge.svg?branch=main)](https://app.codecov.io/github/fureweb-com/cronly)

[English](./README.md) | [한국어](./README.ko.md) | **日本語** | [中文](./README.zh.md)

`cronly add ./report.mjs --daily 08:00` で、スクリプトを毎朝8時に実行できます。Cronly 2.0.0 は **Linux では systemd のユーザータイマー**、**macOS では launchd の LaunchAgent** を使います。Windows では標準の **タスク スケジューラ** を使います。Linux では systemd のユーザーマネージャーが動いていれば、Cronie や `crontab` をインストールする必要はありません。実行時に依存する npm パッケージもありません。

すでに Linux でジョブを登録している場合は、[1.x の cron ジョブを systemd に移行する手順](#migration)を確認してください。

## 実行環境

| プラットフォーム | 必要なシステム機能 |
| --- | --- |
| Linux | systemd ユーザーマネージャー、`systemctl --user`、`/bin/sh` |
| macOS | GUI ログインセッション、`launchctl`、旧ジョブの確認に使う標準の `crontab` |
| Windows | タスク スケジューラ サービス、Windows PowerShell 5.1 |
| cron を選ぶ場合（Unix） | `crontab`、稼働中の cron スケジューラー、`/bin/sh` |

## インストールと最初のジョブ

Node.js 14.8.0 以降が必要です。2.0.0 のソースからインストールするには、プロジェクトディレクトリで次のコマンドを実行し、バージョンが `2.0.0` と表示されることを確認してください。 [2.0.0 のソース](https://github.com/fureweb-com/cronly/tree/codex/release-2.0.0)

```bash
npm pack
npm install --global ./fureweb-cronly-2.0.0.tgz
cronly --version
```

npm で 2.0.0 が公開されたら、`npm install --global @fureweb/cronly@2.0.0` でインストールできます。`npx @fureweb/cronly@2.0.0 --help` でヘルプも確認できます。

スクリプトのあるディレクトリで次のコマンドを実行すると、月曜から金曜の毎朝9時にジョブが動きます。

```bash
cronly add ./report.mjs --weekdays --at 09:00
cronly list
```

スクリプトが `/home/lee/jobs/report.mjs` にある場合、Linux では次のように表示されます。

```text
  9f9d9373  0 9 * * 1-5      /home/lee/jobs/report.mjs  (node, systemd)
```

時刻を変更するには、同じファイルに対してもう一度 `cronly add` を実行します。シンボリックリンク経由でも、同じファイルを指していれば既存のジョブを更新します。

## 名前付きの予定

同じスクリプトに複数の予定を登録できます。名前は大文字と小文字を区別し、選択したスケジューラー内で一意です。同じファイルと名前で再登録するとその予定が更新されます。名前を省略すると従来のパスによる登録が更新されます。一つのパスに複数のジョブがある場合は `--name` または `--id` で選択してください。

```sh
cronly add ./report.mjs --name weekday-report --weekdays --at 09:00
cronly add ./report.mjs --name weekend-report --weekends --at 11:00
cronly list
cronly remove --name weekend-report
```

## すぐに実行してログを読む

systemd、launchd、Windows の `run` は、登録済みジョブの単発実行をスケジューラーに要求し、要求が受理されると終了します。スクリプトの出力後にログを確認できます。任意の cron バックエンドでは CLI が登録時の作業ディレクトリ、ランタイム、PATH、出力設定でスクリプトを直接起動し、終了コードを返します。ほかの環境変数は現在のシェルから継承します。

```sh
cronly run --name weekday-report
cronly logs --name weekday-report
```

どちらのコマンドもパス、`--name`、`--id` のいずれかでジョブを指定します。`logs` は標準出力と標準エラーを含むログファイル全体を標準出力に書き出します。

<a id="migration"></a>

## Linux の 1.x cron ジョブを systemd に移行する

CLI をアップグレードしても、登録済みのジョブはユーザーの crontab に残ります。移行が終わるまで cron を稼働させてください。systemd のユーザーマネージャーがない環境では、Cronly のコマンドに `CRONLY_BACKEND=cron` を指定して引き続き cron を使えます。

1. ジョブを登録したユーザーで systemd のユーザーマネージャーに接続できることを確認します。既存の Cronly ジョブを表示し、各スクリプトのパス、スケジュール、ランタイムを控えます。

   ```bash
   systemctl --user list-timers --all
   CRONLY_BACKEND=cron cronly list
   CRONLY_BACKEND=cron cronly print
   ```

2. ジョブを1件ずつ移行します。以下は平日9時に Node.js で `report.mjs` を実行していた場合の例です。控えておいたパス、スケジュール、ランタイムに合わせて置き換えてください。同じファイルが cron に登録されている間は、Cronly が systemd への二重登録を防ぎます。

   ```bash
   CRONLY_BACKEND=cron cronly remove ./report.mjs &&
     CRONLY_BACKEND=systemd cronly add ./report.mjs --schedule '0 9 * * 1-5' --runtime node
   ```

   新しいジョブを登録できなかった場合は、控えた設定を使って `CRONLY_BACKEND=cron cronly add` で cron ジョブを復元できます。

3. 登録内容と次回の実行時刻を確認します。従来の Cronly ジョブが cron に残っている間は、`doctor` がその旨を表示して終了コード 1 を返します。cron パッケージを削除する場合は、`crontab -l` に手動登録のジョブが残っていないか、このマシンのほかのジョブが cron を使っていないかも確認してください。

   ```bash
   CRONLY_BACKEND=systemd cronly list
   systemctl --user list-timers --all 'cronly-*.timer'
   CRONLY_BACKEND=systemd cronly doctor
   ```

## スケジュールの指定

`add` 1回につき1つのスケジュールを指定します。時刻は24時間表記で、曜日には `sun`、`mon`、`tue`、`wed`、`thu`、`fri`、`sat` を使います。

| スケジュール | オプション |
| --- | --- |
| 毎日 08:00 | `--daily 08:00` |
| 4時間ごと | `--every-hours 4` |
| 10分ごと | `--every-minutes 10` |
| 毎週土曜 10:00 | `--weekly sat --at 10:00` |
| 月・水・金の 09:00 | `--days mon,wed,fri --at 09:00` |
| 平日 09:00 | `--weekdays --at 09:00` |
| 週末 10:00 | `--weekends --at 10:00` |
| 毎月15日 09:00 | `--schedule "0 9 15 * *"` |
| 起動時（タイミングは下記の環境別の説明を参照） | `--reboot` |

`--every-hours` には **1、2、3、4、6、12**、`--every-minutes` には **1、2、3、4、5、6、10、12、15、20、30** を指定できます。1日または1時間を等間隔に分けられる値です。それ以外のスケジュールには `--schedule` を使います。数値の cron 5フィールドにワイルドカード、リスト、範囲、ステップを指定できます。`@hourly`、`@monthly`、`@reboot` などの別名も使えます。

## スケジューラーごとの動作

### Linux · systemd

ジョブごとに `cronly-<id>.service` と `cronly-<id>.timer` を作成します。保存先は `~/.config/systemd/user/` で、`XDG_CONFIG_HOME` に絶対パスを設定した場合は `$XDG_CONFIG_HOME/systemd/user/` です。カレンダータイマーは登録と同時に次の実行を待ちます。その時刻に前回のサービスがまだ動いていれば、その回はスキップします。

`--reboot` ジョブの初回実行は **次にユーザーマネージャーが起動したとき** です。サーバーの起動時からログアウト後もジョブを動かすには、対象のアカウントで `loginctl enable-linger "$USER"` を実行して linger を有効にします。

### macOS · launchd

ジョブごとに `~/Library/LaunchAgents/com.fureweb.cronly.<id>.plist` を作成し、ユーザーの GUI ログインセッションで実行します。`--reboot` は登録時、再登録時、ログイン時に実行されます。スリープ中に逃したカレンダーの予定は、復帰時の1回にまとめられる場合があります。カレンダーの組み合わせが4,096個を超える場合や、`0 0 */2 * 1` のように日付と曜日の条件を launchd で正確に表せない場合は、登録時にエラーになります。

### Windows · タスク スケジューラ

タスクは登録したユーザーのログイン中に実行されます。`--reboot` は次回のログイン時に実行されます。JavaScript は Node.js、`.ps1` はシステムの実行ポリシーに従う Windows PowerShell で起動し、`.exe` は直接実行します。別のインタープリターはインストール後に `--runtime` で指定できます。

```powershell
cronly add .\report.ps1 --weekdays --at 09:00
cronly list
```

日付と曜日の両方を制限する cron 式や、48 個を超えるトリガーを必要とする予定は登録できません。既定のログは `%USERPROFILE%\.cronly\logs\<id>.log` に追記します。

### cron を選ぶ場合

ユーザーの crontab とそれを実行するスケジューラーがある環境で `CRONLY_BACKEND=cron` を指定します。Cronly はユーザーの crontab のうち、自身のマーカーで囲んだブロックを管理します。Linux では `doctor` がプロセス一覧を参照できる場合、cron デーモンも確認します。

Cronly による crontab の変更は順番に処理されます。`crontab -e` でも編集する場合は、その編集を終えてから Cronly でジョブを追加・削除してください。cron バックエンドで生成できるコマンドは1行999バイトまでです。

## 実行環境とログ

- **スクリプトのあるディレクトリ**で実行するので、`./config.json` などの相対パスはそこを基準に解決されます。
- **JavaScript ファイル**（`.js`、`.mjs`、`.cjs`）は `add` を実行した Node.js を使います。Unix の `.sh` は先頭の shebang（例：`#!/bin/bash`）に従い、指定がなければ `/bin/sh` で実行します。ほかのインタープリターは `--runtime python3` のように指定し、実行権限のあるファイルを直接起動するには `--runtime exec` を使います。 `#!/bin/bash -e` のような shebang のオプションも適用するには、スクリプトに実行権限を付けてください。
- Unix のジョブの **PATH** は登録時に使った Node.js のディレクトリ、`/usr/bin`、`/bin` の順です。その Node.js を削除した場合は、新しいバージョンでジョブを再登録してください。 Windows では継承した PATH の先頭に Node.js のディレクトリを追加します。
- 登録時に **ログのパス** を表示します。標準出力と標準エラーは `~/.cronly/logs/<id>.log` に追記されます。登録時に `CRONLY_HOME` を設定すると、保存先は `$CRONLY_HOME/logs/` になります。ログローテーションは別途設定してください。

## ジョブの確認と削除

| コマンド | 動作 |
| --- | --- |
| `cronly list` | ジョブの ID、名前、スケジュール、パス、ランタイムを表示します。 |
| `cronly run --name weekday-report` | 登録済みジョブを一度実行します。 |
| `cronly logs --name weekday-report` | ジョブのログを表示します。 |
| `cronly print` | 管理中の systemd ユニット、LaunchAgent の plist、Windows タスクの XML、または crontab ブロックの内容を表示します。 |
| `cronly doctor` | スケジューラーの状態、スクリプトとランタイムの権限、ログのパスを確認します。問題があれば終了コード 1 を返します。 |
| `cronly remove ./report.mjs` | このファイルの登録を削除します。 |
| `cronly remove --id 9f9d9373` | `list` で確認した ID の登録を削除します。 |

上の Linux ジョブのタイマーの状態と直近の実行ログは、次のコマンドで確認できます。

```bash
systemctl --user status cronly-9f9d9373.timer
tail -n 20 ~/.cronly/logs/9f9d9373.log
```

日本語のヘルプは `cronly --lang ja --help` で確認できます。言語コードは `en`、`ko`、`ja`、`zh` です。既定の言語は `CRONLY_LANG` で指定できます。

## 開発とテスト

CI と同じカバレッジ検査には最新の Node.js LTS 版を使います。

```bash
npm ci
npm test
npm run test:coverage
```

結合テストは実際のスケジューラーを使います。Linux のユーザーセッションでは `npm run test:systemd`、macOS の GUI セッションでは `npm run test:launchd`、cron の検証にはテスト用ユーザーの crontab で `npm run test:integration` を実行してください。 Windows ログインセッションでは `npm run test:windows` で登録とスケジュール実行を確認します。

## ライセンス

[MIT](./LICENSE)
