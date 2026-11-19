# Cronly 2.0.0

[![npm version](https://img.shields.io/npm/v/%40fureweb%2Fcronly?logo=npm)](https://www.npmjs.com/package/@fureweb/cronly)
[![license](https://img.shields.io/github/license/fureweb-com/cronly)](https://github.com/fureweb-com/cronly/blob/main/LICENSE)
[![tests](https://github.com/fureweb-com/cronly/actions/workflows/ci.yml/badge.svg)](https://github.com/fureweb-com/cronly/actions/workflows/ci.yml)
[![coverage](https://codecov.io/github/fureweb-com/cronly/graph/badge.svg?branch=main)](https://app.codecov.io/github/fureweb-com/cronly)

[English](./README.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | **中文**

运行 `cronly add ./report.mjs --daily 08:00`，即可让脚本在每天早上 8 点执行。Cronly 2.0.0 在 **Linux 上使用 systemd 用户定时器**，在 **macOS 上使用 launchd LaunchAgent**。Windows 使用内置的 **任务计划程序**。Linux 的 systemd 用户管理器运行时，无需安装 Cronie 或 `crontab`。Cronly 也没有 npm 运行时依赖。

如果 Linux 上已经有定时任务，请先查看[如何将 1.x 的 cron 任务迁移到 systemd](#migration)。

## 运行条件

| 平台 | 所需系统组件 |
| --- | --- |
| Linux | systemd 用户管理器、`systemctl --user`、`/bin/sh` |
| macOS | 图形登录会话、`launchctl`，以及检查旧任务所用的系统 `crontab` 命令 |
| Windows | 任务计划程序服务、Windows PowerShell 5.1 |
| 可选 cron（Unix） | `crontab`、运行中的 cron 调度器、`/bin/sh` |

## 安装并注册第一个任务

需要 Node.js 14.8.0 或更高版本。从 2.0.0 源码安装时，在项目目录中运行以下命令，确认显示的版本为 `2.0.0`。 [查看 2.0.0 源码](https://github.com/fureweb-com/cronly/tree/codex/release-2.0.0)

```bash
npm pack
npm install --global ./fureweb-cronly-2.0.0.tgz
cronly --version
```

2.0.0 发布到 npm 后，可用 `npm install --global @fureweb/cronly@2.0.0` 安装指定版本，也可用 `npx @fureweb/cronly@2.0.0 --help` 查看帮助。

在脚本所在目录运行以下命令，让脚本在周一至周五早上 9 点执行。

```bash
cronly add ./report.mjs --weekdays --at 09:00
cronly list
```

如果脚本位于 `/home/lee/jobs/report.mjs`，Linux 上的任务列表会显示如下内容。

```text
  9f9d9373  0 9 * * 1-5      /home/lee/jobs/report.mjs  (node, systemd)
```

要调整时间，再对同一文件运行一次 `cronly add` 即可。通过符号链接指向同一文件时，Cronly 也会更新已有的任务。

## 命名计划

同一脚本可以注册多个独立计划。名称区分大小写，在选定的调度器内唯一。以相同的文件和名称重新注册时只更新该计划。省略名称时会更新按路径注册的计划。如果一个路径对应多个任务，请通过 `--name` 或 `--id` 选择。

```sh
cronly add ./report.mjs --name weekday-report --weekdays --at 09:00
cronly add ./report.mjs --name weekend-report --weekends --at 11:00
cronly list
cronly remove --name weekend-report
```

## 立即执行并查看日志

在 systemd、launchd 和 Windows 上，`run` 请求调度器执行一次已注册的任务，请求获接收后命令即结束。待脚本写入输出后即可查看日志。使用可选的 cron 后端时，CLI 按注册时的工作目录、运行时、PATH 和输出重定向在本地运行脚本，并返回其退出码。其他环境变量继承自当前 shell。

```sh
cronly run --name weekday-report
cronly logs --name weekday-report
```

两个命令都可用文件路径、`--name` 或 `--id` 选择任务。`logs` 将完整日志文件写入标准输出，其中包含脚本的标准输出和错误输出。

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

每次运行 `add` 选择一种计划。时间采用 24 小时制，星期用 `sun`、`mon`、`tue`、`wed`、`thu`、`fri`、`sat` 表示。

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

`--every-hours` 可选 **1、2、3、4、6、12**，`--every-minutes` 可选 **1、2、3、4、5、6、10、12、15、20、30**。这些数值能将一天或一小时等分。其他计划可用 `--schedule` 指定。它支持由五个数字字段组成的 cron 表达式，可使用通配符、列表、范围和步长，也支持 `@hourly`、`@monthly`、`@reboot` 等别名。

## 各调度器的运行方式

### Linux · systemd

Cronly 为每个任务创建 `cronly-<id>.service` 和 `cronly-<id>.timer`。默认位置是 `~/.config/systemd/user/`，如果 `XDG_CONFIG_HOME` 设为绝对路径，则存放在 `$XDG_CONFIG_HOME/systemd/user/`。日历定时器注册后就开始等待下次执行。触发时，如果上一次启动的服务仍在运行，本次会跳过。

`--reboot` 任务在**用户管理器下次启动时**首次运行。如果服务器需要在开机时就执行任务，并在用户退出后继续调度，可为该账户运行 `loginctl enable-linger "$USER"` 以启用 linger。

### macOS · launchd

每个任务对应一个 `~/Library/LaunchAgents/com.fureweb.cronly.<id>.plist` 文件，在用户的图形登录会话中运行。`--reboot` 任务在注册、重新注册和登录时运行。睡眠期间错过的日历计划可能在唤醒时合并执行一次。日历组合超过 4,096 个，或日期与星期的组合条件无法由 launchd 准确表达（例如 `0 0 */2 * 1`）时，Cronly 会在注册时报错。

### Windows · 任务计划程序

任务在注册用户登录期间运行。`--reboot` 在下次登录时执行。JavaScript 使用 Node.js，`.ps1` 使用遵循系统执行策略的 Windows PowerShell，`.exe` 直接执行。其他已安装的解释器可以通过 `--runtime` 指定。

```powershell
cronly add .\report.ps1 --weekdays --at 09:00
cronly list
```

同时限制日期和星期的 cron 表达式，以及需要超过 48 个触发器的计划，均无法注册。日志默认追加到 `%USERPROFILE%\.cronly\logs\<id>.log`。

### 可选的 cron 后端

如果系统有用户 crontab 和执行它的 cron 调度器，可设置 `CRONLY_BACKEND=cron`。Cronly 管理用户 crontab 中带有自身标记的任务块。在 Linux 上，如果能读取进程列表，`doctor` 也会检查 cron 守护进程。

Cronly 会依次处理自己对 crontab 的更改。如果也在用 `crontab -e` 编辑，请先结束编辑，再用 Cronly 添加或移除任务。cron 后端生成的单条命令最多为 999 字节。

## 脚本环境与日志

- 每个任务都从**脚本所在目录**启动，`./config.json` 等相对路径从该目录解析。
- **JavaScript 文件**（`.js`、`.mjs` 和 `.cjs`）使用执行 `add` 的 Node.js。在 Unix 上，`.sh` 文件按首行的解释器声明（例如 `#!/bin/bash`）运行。没有声明时使用 `/bin/sh`。其他解释器可用 `--runtime python3` 等方式指定。要直接启动具有执行权限的文件，请使用 `--runtime exec`。对于 `#!/bin/bash -e` 这样的声明，请为脚本添加执行权限，以保留解释器选项。
- Unix 任务的 **PATH** 依次包含注册时所用 Node.js 的目录、`/usr/bin` 和 `/bin`。如果移除了那个版本的 Node.js，请用新版本重新注册任务。 Windows 会在继承的 PATH 开头添加 Node.js 所在的目录。
- 注册时会显示**日志路径**。标准输出和标准错误都会追加到 `~/.cronly/logs/<id>.log`。注册时设置 `CRONLY_HOME` 可将日志写入 `$CRONLY_HOME/logs/`。日志轮转需自行配置。

## 查看和删除任务

| 命令 | 作用 |
| --- | --- |
| `cronly list` | 列出任务 ID、名称、计划、路径和运行时。 |
| `cronly run --name weekday-report` | 执行一次已注册的任务。 |
| `cronly logs --name weekday-report` | 输出任务日志。 |
| `cronly print` | 输出受管理的 systemd 单元、LaunchAgent plist、Windows 任务 XML 或 crontab 任务块的原文。 |
| `cronly doctor` | 检查调度器状态、脚本和运行时的权限，以及日志路径。检查失败时返回退出码 1。 |
| `cronly remove ./report.mjs` | 删除这个文件的任务注册。 |
| `cronly remove --id 9f9d9373` | 按 `list` 中显示的 ID 删除任务注册。 |

要检查上方 Linux 示例的定时器状态和最近的脚本输出，可运行以下命令。

```bash
systemctl --user status cronly-9f9d9373.timer
tail -n 20 ~/.cronly/logs/9f9d9373.log
```

可用 `cronly --lang zh --help` 查看中文帮助。支持的语言代码为 `en`、`ko`、`ja` 和 `zh`。可通过 `CRONLY_LANG` 设置默认语言。

## 开发与测试

使用最新的 Node.js LTS 版本即可运行与 CI 相同的覆盖率检查。

```bash
npm ci
npm test
npm run test:coverage
```

集成测试使用真实的调度器。Linux 用户会话中运行 `npm run test:systemd`，macOS 图形会话中运行 `npm run test:launchd`。要测试 cron，请使用测试账户的 crontab 运行 `npm run test:integration`。 在 Windows 登录会话中运行 `npm run test:windows` 可验证注册和定时执行。

## 许可证

[MIT](./LICENSE)
