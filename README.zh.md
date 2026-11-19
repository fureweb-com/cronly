# Cronly 2.0.0

[![npm version](https://img.shields.io/npm/v/%40fureweb%2Fcronly?logo=npm)](https://www.npmjs.com/package/@fureweb/cronly)
[![license](https://img.shields.io/github/license/fureweb-com/cronly)](https://github.com/fureweb-com/cronly/blob/main/LICENSE)
[![tests](https://github.com/fureweb-com/cronly/actions/workflows/ci.yml/badge.svg)](https://github.com/fureweb-com/cronly/actions/workflows/ci.yml)
[![coverage](https://codecov.io/github/fureweb-com/cronly/graph/badge.svg?branch=main)](https://app.codecov.io/github/fureweb-com/cronly)

[English](./README.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | **中文**

Cronly 使用 **Linux 的 systemd 用户定时器**、**macOS 的 launchd LaunchAgent** 和 **Windows 内置的任务计划程序**来定时执行脚本。Linux 的 systemd 用户管理器运行时，无需安装 Cronie 或 `crontab`。Cronly 也没有 npm 运行时依赖。

如果 Linux 上已经有定时任务，请先查看[如何将 1.x 的 cron 任务迁移到 systemd](#migration)。

## 运行条件

| 平台 | 所需系统组件 |
| --- | --- |
| Linux | systemd 用户管理器、`systemctl --user`、`/bin/sh` |
| macOS | 图形登录会话、`launchctl`，以及检查旧任务所用的系统 `crontab` 命令 |
| Windows | 已登录的用户会话、任务计划程序服务、Windows PowerShell 5.1 |
| 可选 cron（Unix） | `crontab`、运行中的 cron 调度器、`/bin/sh` |

## 安装并注册第一个任务

需要 Node.js 14.8.0 或更高版本。2.0.0 发布到 npm 前，可直接从发布分支安装。在 Windows 上，可在命令提示符中运行以下示例。如果 PowerShell 的执行策略阻止 npm 的启动脚本，请使用 `npm.cmd`、`npx.cmd` 和 `cronly.cmd`。

```bash
npm install --global https://github.com/fureweb-com/cronly/archive/refs/heads/codex/release-2.0.0.tar.gz
cronly --version
```

确认输出的版本为 `2.0.0`。如果已有源码，也可以在项目目录中先运行 `npm pack`，再运行 `npm install --global ./fureweb-cronly-2.0.0.tgz`。2.0.0 发布到 npm 后，可用 `npm install --global @fureweb/cronly@2.0.0` 安装，或用 `npx @fureweb/cronly@2.0.0 --help` 查看帮助。

在准备用来存放任务的空目录中，将下面一行保存为 `report.mjs`。

```js
console.log(new Date().toISOString())
```

在同一目录中注册工作日上午 9 点的计划，然后立即执行一次。

```bash
cronly add ./report.mjs --name weekday-report --weekdays --at 09:00
cronly list
cronly run --name weekday-report
```

运行 `cronly logs --name weekday-report` 查看输出。如果首次查询为空，只需再次查询日志。出现新的 UTC 时间戳即表示脚本已执行。要停止这个示例任务，运行 `cronly remove --name weekday-report`。

如果脚本位于 `/home/lee/jobs/report.mjs`，Linux 上的任务列表会显示如下内容。

```text
  68b547a7  [weekday-report]  0 9 * * 1-5      /home/lee/jobs/report.mjs  (node, systemd)
```

## 命名计划

同一脚本可以注册多个计划。名称区分大小写，在当前用户选定的调度器内唯一。名称长度为 1～64 个字符，以 Unicode 字母（含汉字）或数字开头，后续还可使用 `.`、`_` 和 `-`。

用同一文件和名称再次运行 `add` 即可更新该计划。Cronly 也能识别指向同一文件的符号链接。省略名称时会单独注册一个按路径管理的计划。调用 `run`、`logs` 或 `remove` 时，从文件路径、`--name`、`--id` 中选择一项。如果一个路径匹配多个计划，请用名称或 ID 选择其中一个。

```sh
cronly add ./report.mjs --name weekday-report --weekdays --at 10:00
cronly add ./report.mjs --name weekend-report --weekends --at 11:00
cronly list
cronly remove --name weekend-report
```

## 在脚本和智能体中使用

- 调用 `add`、`run`、`logs` 和 `remove` 时，请使用同一操作系统账户、调度器和任务名称。默认调度器由操作系统决定。手动选择时，每次调用都要将 `CRONLY_BACKEND` 设为 `systemd`、`launchd`、`windows` 或 `cron`。`cronly --lang en doctor` 用英语输出诊断结果，检查全部通过时返回 0，发现问题时返回 1。
- 在 systemd、launchd 和 Windows 上，`run` 返回 0 表示调度器已接受执行请求。使用可选的 cron 后端时，CLI 按注册时的工作目录、运行时、PATH 和输出设置在本地执行脚本，其他环境变量继承自当前 shell，退出码取自脚本。
- `logs` 输出完整日志，包含历次运行的标准输出和标准错误。日志文件尚未创建时，会向标准错误输出提示并返回 0。要确认某次运行已完成，可设置超时并轮询新的时间戳或完成标记。在 `remove` 前可用命令查看日志，删除任务后已有日志文件仍保存在 `add` 显示的路径。

<a id="migration"></a>

## 将 Linux 上的 1.x cron 任务迁移到 systemd

升级 CLI 后，已有任务仍保存在用户的 crontab 中。迁移期间请保留 cron 并让它继续运行。在没有 systemd 用户管理器的机器上，可以为 Cronly 命令设置 `CRONLY_BACKEND=cron`，继续使用 cron。

1. 用原来注册任务的账户确认可以连接 systemd 用户管理器。查看已有的 Cronly 任务，记下每个脚本的路径、计划和运行时。

   ```bash
   systemctl --user list-timers --all
   CRONLY_BACKEND=cron cronly list
   CRONLY_BACKEND=cron cronly print
   ```

2. 逐个迁移任务。以下示例假设 `report.mjs` 原本由 Node.js 在工作日早上 9 点运行。请替换为刚记下的路径、计划和运行时。同一文件仍在 cron 中注册时，Cronly 会阻止它在 systemd 中重复注册。

   ```bash
   CRONLY_BACKEND=cron cronly remove ./report.mjs &&
     CRONLY_BACKEND=systemd cronly add ./report.mjs --schedule '0 9 * * 1-5' --runtime node
   ```

   如果新任务注册失败，可用之前记录的设置，通过 `CRONLY_BACKEND=cron cronly add` 恢复 cron 任务。

3. 检查已注册的任务和下次执行时间。只要 cron 中还留有旧的 Cronly 任务，`doctor` 就会提示并返回退出码 1。要卸载 cron 软件包，请先用 `crontab -l` 检查手动添加的任务，并确认机器上是否还有其他任务依赖 cron。

   ```bash
   CRONLY_BACKEND=systemd cronly list
   systemctl --user list-timers --all 'cronly-*.timer'
   CRONLY_BACKEND=systemd cronly doctor
   ```

## 设置执行时间

每次运行 `add` 选择一种计划。时刻按调度器的本地时间填写，小时和分钟均为两位数字，格式为 `HH:MM`。星期用 `sun`、`mon`、`tue`、`wed`、`thu`、`fri`、`sat` 表示。

| 执行时间 | 选项 |
| --- | --- |
| 每天 08:00 | `--daily 08:00` |
| 每 4 小时 | `--every-hours 4` |
| 每 10 分钟 | `--every-minutes 10` |
| 每周六 10:00 | `--weekly sat --at 10:00` |
| 周一、三、五 09:00 | `--days mon,wed,fri --at 09:00` |
| 工作日 09:00 | `--weekdays --at 09:00` |
| 周末 10:00 | `--weekends --at 10:00` |
| 每月 15 日 09:00 | `--schedule "0 9 15 * *"` |
| 启动时（具体时机见下文） | `--reboot` |

`--every-hours` 可选 **1、2、3、4、6、8、12**，`--every-minutes` 可选 **1、2、3、4、5、6、10、12、15、20、30**。这些数值能将一天或一小时等分。其他计划可按分、时、日、月、星期的顺序编写表达式，加上引号后传给 `--schedule`。各数字字段支持通配符、列表、范围和步长。支持的别名为 `@hourly`、`@daily`、`@weekly`、`@monthly`、`@yearly`、`@annually` 和 `@reboot`。

## 各调度器的运行方式

### Linux · systemd

以任务所属的账户运行 `systemctl --user list-timers --all`，可以检查当前会话是否能连接用户管理器。在 SSH 或 CI 会话中也可这样检查。

Cronly 为每个任务创建 `cronly-<id>.service` 和 `cronly-<id>.timer`。默认位置是 `~/.config/systemd/user/`，如果 `XDG_CONFIG_HOME` 设为绝对路径，则存放在 `$XDG_CONFIG_HOME/systemd/user/`。日历定时器注册后就开始等待下次执行。触发时，如果上一次启动的服务仍在运行，本次会跳过。

`--reboot` 任务在**用户管理器下次启动时**首次运行。如果服务器需要在开机时就执行任务，并在用户退出后继续调度，可为该账户运行 `loginctl enable-linger "$USER"` 以启用 linger。

### macOS · launchd

每个任务对应一个 `~/Library/LaunchAgents/com.fureweb.cronly.<id>.plist` 文件，在用户的图形登录会话中运行。`--reboot` 任务在注册、重新注册和登录时运行。睡眠期间错过的日历计划可能在唤醒时合并执行一次。日历组合超过 4,096 个，或日期与星期的组合条件无法由 launchd 准确表达（例如 `0 0 */2 * 1`）时，Cronly 会在注册时报错。

### Windows · 任务计划程序

任务在注册用户登录期间运行。`--reboot` 在下次登录时执行。JavaScript 使用 Node.js，`.exe` 直接执行。其他已安装的解释器可以通过 `--runtime` 指定。

PowerShell 会在执行计划中的 `.ps1` 时应用执行策略。策略为 `Restricted` 时，即使任务注册成功，脚本也会被阻止运行，日志中可能出现 `UnauthorizedAccess`。前面的 JavaScript 示例在此策略下也能运行。[Windows PowerShell 执行策略](https://learn.microsoft.com/zh-cn/powershell/module/microsoft.powershell.core/about/about_execution_policies?view=powershell-5.1)

```powershell
Get-ExecutionPolicy
cronly.cmd add .\report.mjs --name weekday-report --weekdays --at 09:00
```

同时限制日期和星期的 cron 表达式，以及需要超过 48 个触发器的计划，均无法注册。日志默认追加到 `%USERPROFILE%\.cronly\logs\<id>.log`。

### 可选的 cron 后端

如果系统有用户 crontab 和执行它的 cron 调度器，可设置 `CRONLY_BACKEND=cron`。Cronly 管理用户 crontab 中带有自身标记的任务块。在 Linux 上，如果能读取进程列表，`doctor` 也会检查 cron 守护进程。

Cronly 会依次处理自己对 crontab 的更改。如果也在用 `crontab -e` 编辑，请先结束编辑，再用 Cronly 添加或移除任务。cron 后端生成的单条命令最多为 999 字节。

## 脚本环境与日志

- 每个任务都从**脚本所在目录**启动，`./config.json` 等相对路径从该目录解析。
- **JavaScript 文件**（`.js`、`.mjs` 和 `.cjs`）使用执行 `add` 的 Node.js。在 Unix 上，`.sh` 文件按首行的解释器声明（例如 `#!/bin/bash`）运行。没有声明时使用 `/bin/sh`。其他解释器可用 `--runtime python3` 等方式指定。要直接启动具有执行权限的文件，请使用 `--runtime exec`。对于 `#!/bin/bash -e` 这样的声明，请为脚本添加执行权限，以保留解释器选项。
- Unix 任务的 **PATH** 依次包含注册时所用 Node.js 的目录、`/usr/bin` 和 `/bin`。如果移除了那个版本的 Node.js，请用新版本重新注册任务。 Windows 会在继承的 PATH 开头添加 Node.js 所在的目录。
- 注册时会显示**日志路径**。标准输出和标准错误都会追加到 `~/.cronly/logs/<id>.log`。注册时设置 `CRONLY_HOME` 可将日志写入 `$CRONLY_HOME/logs/`，任务仍由同一用户的调度器管理。日志轮转需自行配置。

## 查看和删除任务

| 命令 | 作用 |
| --- | --- |
| `cronly list` | 列出任务 ID、名称、计划、路径和运行时。 |
| `cronly run --name weekday-report` | 执行一次已注册的任务。 |
| `cronly logs --name weekday-report` | 输出任务日志。 |
| `cronly print` | 输出受管理的 systemd 单元、LaunchAgent plist、Windows 任务 XML 或 crontab 任务块的原文。 |
| `cronly doctor` | 检查调度器状态、脚本和运行时的权限，以及日志路径。检查失败时返回退出码 1。 |
| `cronly remove ./report.mjs` | 删除这个文件的任务注册。 |
| `cronly remove --id 68b547a7` | 按 `list` 中显示的 ID 删除任务注册。 |

要检查上方 Linux 示例的定时器状态和最近的脚本输出，可运行以下命令。

```bash
systemctl --user status cronly-68b547a7.timer
tail -n 20 ~/.cronly/logs/68b547a7.log
```

可用 `cronly --lang zh --help` 查看中文帮助。支持的语言代码为 `en`、`ko`、`ja` 和 `zh`。可通过 `CRONLY_LANG` 设置默认语言。

## 开发与测试

在 Linux 和 macOS 上使用最新的 Node.js LTS 版本，即可运行与 CI 相同的覆盖率检查。

```bash
npm ci
npm test
npm run test:coverage
```

集成测试使用真实的调度器。Linux 用户会话中运行 `npm run test:systemd`，macOS 图形会话中运行 `npm run test:launchd`。要测试 cron，请使用测试账户的 crontab 运行 `npm run test:integration`。

在已登录的 Windows 会话中，`npm.cmd test` 和 `npm.cmd run test:windows` 运行同一组任务计划程序测试。测试等待 1 分钟的定时触发器启动 JavaScript，随后按任务名称运行本地未签名的 `.ps1`。在 `Restricted` 策略下，即使 JavaScript 检查通过，最后一项 PowerShell 检查仍会失败。

## 许可证

[MIT](./LICENSE)
