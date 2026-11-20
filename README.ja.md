# Cronly 2.0.0

[![npm version](https://img.shields.io/npm/v/%40fureweb%2Fcronly?logo=npm)](https://www.npmjs.com/package/@fureweb/cronly)
[![license](https://img.shields.io/github/license/fureweb-com/cronly)](https://github.com/fureweb-com/cronly/blob/main/LICENSE)
[![tests](https://github.com/fureweb-com/cronly/actions/workflows/ci.yml/badge.svg)](https://github.com/fureweb-com/cronly/actions/workflows/ci.yml)
[![coverage](https://codecov.io/github/fureweb-com/cronly/graph/badge.svg?branch=main)](https://app.codecov.io/github/fureweb-com/cronly)

[English](./README.md) | [한국어](./README.ko.md) | **日本語** | [中文](./README.zh.md)

Cronly は、**Linux の systemd ユーザータイマー**、**macOS の launchd LaunchAgent**、**Windows 標準のタスク スケジューラ**でスクリプトを定期実行します。Linux では systemd のユーザーマネージャーが動いていれば、Cronie や `crontab` をインストールする必要はありません。実行時に依存する npm パッケージもありません。

すでに Linux でジョブを登録している場合は、[1.x の cron ジョブを systemd に移行する手順](#migration)を確認してください。

## 実行環境

| プラットフォーム | 必要なシステム機能 |
| --- | --- |
| Linux | systemd 237 以降のユーザーマネージャー、`systemctl --user`、`/bin/sh` |
| macOS | GUI ログインセッション、`launchctl`、旧ジョブの確認に使う標準の `crontab` |
| Windows | サインイン中のユーザー、タスク スケジューラ サービス、Windows PowerShell 5.1、Windows Script Host（JScript） |
| cron を選ぶ場合（Unix） | `crontab`、稼働中の cron スケジューラー、`/bin/sh` |

## インストールと最初のジョブ

Node.js 14.8.0 以降が必要です。npm で 2.0.0 が公開されるまでは、リリースブランチから直接インストールできます。Windows では以下の例をコマンド プロンプトで実行してください。PowerShell の実行ポリシーで npm の起動スクリプトがブロックされる場合は、`npm.cmd`、`npx.cmd`、`cronly.cmd` を使います。

```bash
npm install --global https://github.com/fureweb-com/cronly/archive/refs/heads/codex/release-2.0.0.tar.gz
cronly --version
```

バージョンが `2.0.0` と表示されることを確認してください。手元にソースがある場合は、プロジェクトディレクトリで `npm pack`、`npm install --global ./fureweb-cronly-2.0.0.tgz` の順に実行してもインストールできます。npm での公開後は `npm install --global @fureweb/cronly@2.0.0` でインストールでき、`npx @fureweb/cronly@2.0.0 --help` でヘルプを確認できます。

ジョブ用の空のディレクトリに、次の1行を `report.mjs` として保存します。

```js
console.log(new Date().toISOString())
```

同じディレクトリで平日9時の予定を登録し、その場で1回実行します。

```bash
cronly add ./report.mjs --name weekday-report --weekdays --at 09:00
cronly list
cronly run --name weekday-report
```

`cronly logs --name weekday-report` で出力を確認します。初回の出力が空なら、ログの確認だけを繰り返してください。新しい UTC 時刻が表示されれば実行できています。例の予定を削除するには `cronly remove --name weekday-report` を実行します。

スクリプトが `/home/lee/jobs/report.mjs` にある場合、Linux では次のように表示されます。

```text
  68b547a7  [weekday-report]  0 9 * * 1-5      /home/lee/jobs/report.mjs  (node, systemd)
```

## 名前付きの予定

同じスクリプトに複数の予定を登録できます。名前は大文字と小文字を区別し、ユーザーが選択したスケジューラー内で一意です。長さは1～64文字で、Unicode の文字または数字で始めます。2文字目以降は `.`、`_`、`-` も使えます。

同じファイルと名前で `add` を再実行すると、その予定が更新されます。同じファイルへのシンボリックリンクも認識されます。名前を省略した登録には独立した予定が作られます。`run`、`logs`、`remove` にはパス、`--name`、`--id` のいずれか一つを指定します。一つのパスに複数の予定がある場合は名前か ID で選択してください。

```sh
cronly add ./report.mjs --name weekday-report --weekdays --at 10:00
cronly add ./report.mjs --name weekend-report --weekends --at 11:00
cronly list
cronly remove --name weekend-report
```

## スクリプトやエージェントから使う

- `add`、`run`、`logs`、`remove` には、同じ OS ユーザー、スケジューラー、ジョブ名を使います。既定のスケジューラーは OS ごとに決まっています。明示的に選ぶには、各呼び出しで `CRONLY_BACKEND` に `systemd`、`launchd`、`windows`、`cron` のいずれかを指定してください。`cronly --lang en doctor` は英語で診断結果を表示し、すべて正常なら 0、問題があれば 1 を返します。
- systemd、launchd、Windows で `run` が返す 0 は、スケジューラーが実行要求を受理したことを示します。任意の cron バックエンドでは、登録時の作業ディレクトリ、ランタイム、PATH、出力先を使って直接実行し、ほかの環境変数はシェルから引き継ぎます。終了コードはスクリプトのものです。 この環境の違いは標準エラー出力でも通知します。
- `logs` は過去の実行分も含め、標準出力と標準エラーのログ全体を表示します。 `--tail 20` で末尾の 20 行だけを読めます。ログファイルがまだなければ標準エラーに案内を出し、0 で終了します。特定の実行を確認するには、待ち時間に上限を設け、新しい時刻や完了メッセージが記録されたかを繰り返し確認します。`remove` の前にログを確認してください。削除後も既存のログファイルは `add` が表示したパスに残ります。

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

3. 登録内容と次回の実行時刻を確認します。systemd の `doctor` は cron に残っているジョブを参考情報として表示します。cron パッケージを削除する場合は、`crontab -l` に手動登録のジョブが残っていないか、このマシンのほかのジョブが cron を使っていないかも確認してください。

   ```bash
   CRONLY_BACKEND=systemd cronly list
   systemctl --user list-timers --all 'cronly-*.timer'
   CRONLY_BACKEND=systemd cronly doctor
   ```

## スケジュールの指定

`add` 1回につき1つのスケジュールを指定します。時刻はスケジューラーの現地時刻で、時と分を2桁ずつ `HH:MM` で指定します。曜日には `sun`、`mon`、`tue`、`wed`、`thu`、`fri`、`sat` を使います。

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

`--every-hours` には **1、2、3、4、6、8、12**、`--every-minutes` には **1、2、3、4、5、6、10、12、15、20、30** を指定できます。1日または1時間を等間隔に分けられる値です。それ以外は、分・時・日・月・曜日の順に書いた式を引用符で囲み、`--schedule` に渡します。数値フィールドはワイルドカード、リスト、範囲、ステップに対応します。別名には `@hourly`、`@daily`、`@weekly`、`@monthly`、`@yearly`、`@annually`、`@reboot` が使えます。

## スケジューラーごとの動作

### Linux · systemd

ジョブを所有するユーザーで `systemctl --user list-timers --all` を実行すると、そのセッションからユーザーマネージャーに接続できるか確認できます。SSH や CI のセッションでも同じ手順を使えます。

ジョブごとに `cronly-<id>.service` と `cronly-<id>.timer` を作成します。保存先は `~/.config/systemd/user/` で、`XDG_CONFIG_HOME` に絶対パスを設定した場合は `$XDG_CONFIG_HOME/systemd/user/` です。カレンダータイマーは登録と同時に次の実行を待ちます。その時刻に前回のサービスがまだ動いていれば、その回はスキップします。

ユニットファイルの片方が欠けている、または変更された場合は、元の `add` コマンドで修復するか、`cronly remove --id <id>` で削除できます。所有元を確認できないファイルは保持されます。 新しい登録では、元のユニットが片方だけ残っていても、名前またはスクリプトのパスでログを表示したり登録を削除したりできます。ID だけを持つ以前のタイマーには `list` に表示された ID を指定してください。

`--reboot` ジョブの初回実行は **次にユーザーマネージャーが起動したとき** です。サーバーの起動時からログアウト後もジョブを動かすには、対象のアカウントで `loginctl enable-linger "$USER"` を実行して linger を有効にします。

### macOS · launchd

ジョブごとに `~/Library/LaunchAgents/com.fureweb.cronly.<id>.plist` を作成し、ユーザーの GUI ログインセッションで実行します。`--reboot` は登録時、再登録時、ログイン時に実行されます。スリープ中に逃したカレンダーの予定は、復帰時の1回にまとめられる場合があります。カレンダーの組み合わせが4,096個を超える場合や、`0 0 */2 * 1` のように日付と曜日の条件を launchd で正確に表せない場合は、登録時にエラーになります。

### Windows · タスク スケジューラ

タスクは登録したユーザーのログイン中に実行されます。`--reboot` は次回のログイン時に実行されます。JavaScript は Node.js で起動し、`.exe` は直接実行します。別のインタープリターはインストール後に `--runtime` で指定できます。

新しく登録したタスクはコンソールを表示せず、スクリプトの終了コードを返します。共通のランチャーは `%LOCALAPPDATA%\Cronly\windows-launcher-v1.js` に保存されます。既存タスクには `add` を再実行して適用します。 ポリシーで Windows Script Host が無効な場合、`add` は登録前に停止し、`doctor` は該当するレジストリ設定を表示します。

PowerShell は、予約した `.ps1` の実行時に実行ポリシーを適用します。`Restricted` の場合、タスクの登録に成功しても実行がブロックされ、ログに `UnauthorizedAccess` が記録されることがあります。上の JavaScript の例はこのポリシーでも動作します。[Windows PowerShell の実行ポリシー](https://learn.microsoft.com/ja-jp/powershell/module/microsoft.powershell.core/about/about_execution_policies?view=powershell-5.1)

```powershell
Get-ExecutionPolicy
cronly.cmd add .\report.mjs --name weekday-report --weekdays --at 09:00
```

日付と曜日の両方を制限する cron 式や、48 個を超えるトリガーを必要とする予定は登録できません。既定のログは `%USERPROFILE%\.cronly\logs\<id>.log` に追記します。

タスク スケジューラで定義が変更されると、`doctor` は Windows 上のタスク名を表示します。内容を確認し、Cronly 所有のタスクなら `cronly remove --id <id>` で削除してから再登録してください。

### cron を選ぶ場合

ユーザーの crontab とそれを実行するスケジューラーがある環境で `CRONLY_BACKEND=cron` を指定します。Cronly はユーザーの crontab のうち、自身のマーカーで囲んだブロックを管理します。Linux では `doctor` がプロセス一覧を参照できる場合、cron デーモンも確認します。

Cronly による crontab の変更は順番に処理されます。`crontab -e` でも編集する場合は、その編集を終えてから Cronly でジョブを追加・削除してください。cron バックエンドで生成できるコマンドは1行999バイトまでです。

## 実行環境とログ

- **スクリプトのあるディレクトリ**で実行するので、`./config.json` などの相対パスはそこを基準に解決されます。
- **JavaScript ファイル**（`.js`、`.mjs`、`.cjs`）は `add` を実行した Node.js を使います。Unix の `.sh` は先頭の shebang（例：`#!/bin/bash`）に従い、指定がなければ `/bin/sh` で実行します。ほかのインタープリターは `--runtime python3` のように指定し、実行権限のあるファイルを直接起動するには `--runtime exec` を使います。 `#!/bin/bash -e` のような shebang のオプションも適用するには、スクリプトに実行権限を付けてください。
- Unix のジョブの **PATH** は登録時に使った Node.js のディレクトリ、`/usr/bin`、`/bin` の順です。その Node.js を削除した場合は、新しいバージョンでジョブを再登録してください。 Windows では継承した PATH の先頭に Node.js のディレクトリを追加します。
- 登録時に **ログのパス** を表示します。標準出力と標準エラーは `~/.cronly/logs/<id>.log` に追記されます。登録時に `CRONLY_HOME` を設定すると、ログの保存先は `$CRONLY_HOME/logs/` になります。ジョブは同じユーザーのスケジューラーで管理されます。ログローテーションは別途設定してください。

## ジョブの確認と削除

| コマンド | 動作 |
| --- | --- |
| `cronly list` | ジョブの ID、名前、スケジュール、パス、ランタイムを表示します。 |
| `cronly run --name weekday-report` | 登録済みジョブを一度実行します。 |
| `cronly logs --name weekday-report --tail 20` | ジョブログの末尾 20 行を表示します。 |
| `cronly print` | 管理中の systemd ユニット、LaunchAgent の plist、Windows タスクの XML、または crontab ブロックの内容を表示します。 |
| `cronly doctor` | スケジューラーの状態、スクリプトとランタイムの権限、ログのパスを確認します。問題があれば終了コード 1 を返します。 |
| `cronly remove ./report.mjs` | このファイルの登録を削除します。 |
| `cronly remove --id 68b547a7` | `list` で確認した ID の登録を削除します。 |

上の Linux ジョブのタイマーの状態と直近の実行ログは、次のコマンドで確認できます。

```bash
systemctl --user status cronly-68b547a7.timer
cronly logs --id 68b547a7 --tail 20
```

日本語のヘルプは `cronly --lang ja --help` で確認できます。言語コードは `en`、`ko`、`ja`、`zh` です。既定の言語は `CRONLY_LANG` で指定できます。

## 開発とテスト

Linux、macOS、Windows の CI では `.nvmrc` に固定した Node.js LTS 版を使います。Linux では最低サポート版の 14.8.0 でも実際の systemd 統合テストを実行します。ローカルのカバレッジ検査には固定された LTS 版を使ってください。

```bash
npm ci
npm test
npm run test:coverage
```

結合テストは実際のスケジューラーを使います。Linux のユーザーセッションでは `npm run test:systemd`、macOS の GUI セッションでは `npm run test:launchd`、cron の検証にはテスト用ユーザーの crontab で `npm run test:integration` を実行してください。

Windows のログインセッションでは、`npm.cmd test` と `npm.cmd run test:windows` は同じタスク スケジューラのテストを実行します。1分間隔のトリガーで JavaScript が実行されるのを待ち、次に署名のないローカルの `.ps1` をジョブ名で実行します。`Restricted` の場合、JavaScript の検査が通っても最後の PowerShell の検査で失敗します。

## ライセンス

[MIT](./LICENSE)
