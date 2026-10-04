# Cronly

[![npm version](https://img.shields.io/npm/v/%40fureweb%2Fcronly?logo=npm)](https://www.npmjs.com/package/@fureweb/cronly)
[![npm downloads](https://img.shields.io/npm/dm/%40fureweb%2Fcronly?logo=npm)](https://www.npmjs.com/package/@fureweb/cronly)
[![license](https://img.shields.io/github/license/fureweb-com/cronly)](https://github.com/fureweb-com/cronly/blob/main/LICENSE)
[![tests](https://github.com/fureweb-com/cronly/actions/workflows/ci.yml/badge.svg)](https://github.com/fureweb-com/cronly/actions/workflows/ci.yml)
[![coverage](https://codecov.io/github/fureweb-com/cronly/graph/badge.svg?branch=main)](https://app.codecov.io/github/fureweb-com/cronly)
[![stars](https://img.shields.io/github/stars/fureweb-com/cronly?style=social)](https://github.com/fureweb-com/cronly/stargazers)

轻松调度脚本 — 无需 cron 语法。
直接表达你的意思：每天 8 点、工作日 9 点、每 4 小时。
需要时也可以直接使用 cron expression。Cronly 会在底层安全地管理 crontab 条目。

[English](./README.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | **[中文](./README.zh.md)**

## 1 分钟上手

```bash
# 每天 8:00 运行
cronly add ./daily-report.mjs --daily 08:00
# 相同含义的 cron expression
cronly add ./daily-report.mjs --schedule "0 8 * * *"

# 工作日 9:00 运行
cronly add ./notify.mjs --weekdays --at 09:00
# 相同含义的 cron expression
cronly add ./notify.mjs --schedule "0 9 * * 1-5"

# 每 4 小时运行
cronly add ./sync.mjs --every-hours 4
# 相同含义的 cron expression
cronly add ./sync.mjs --schedule "0 */4 * * *"

# 每周六 0:00 运行
cronly add ./weekly-cleanup.mjs --weekly sat --at 00:00
# 相同含义的 cron expression
cronly add ./weekly-cleanup.mjs --schedule "0 0 * * 6"

# 查看这个工具管理的条目
cronly list
```

适合这些场景：

- 想用 `--daily`、`--weekdays`、`--every-hours` 这样直观的标志来调度脚本
- 不想记 cron 语法也能设置常见调度
- 复杂场景下想直接使用 cron expression（`--schedule "0 */6 * * 1-3"`）
- 不想手动编辑其他已有的 crontab 条目
- 想对同一个文件重复执行 `add` 来更新调度

## 为什么需要？

使用 `crontab -e` 手动管理会导致以下问题：

- 不小心将同一脚本注册两次
- 难以一眼判断哪个条目对应哪个脚本
- 注册、修改、删除时可能误改其他 cron 条目
- 脚本路径变更时忘记同步 crontab

**Cronly** 解决了这些问题：

| 手动管理 crontab | Cronly |
|---|---|
| 可能重复注册 | 同一文件自动去重（包括符号链接和大小写差异） |
| 可能误编辑其他条目 | 仅修改管理块，完全隔离 |
| 难以识别条目 | 通过元数据注释识别 |
| 变更时需手动同步 | `add` 以 upsert 方式运行 |

## 特性

- 零外部 npm 依赖 — 仅使用 Node.js 内置模块
- 无需 DB、服务器或守护进程 — 实际 crontab 是唯一数据源
- 管理条目带有元数据注释，与现有手动条目完全隔离
- 包含空格、单引号和 `%` 的路径会被安全地进行 shell 引用处理
- 任务在脚本所在目录中运行，输出记录到 `~/.cronly/logs/<id>.log`
- 支持 cron 别名（`@reboot`、`@daily`、`@weekly` 等）
- 基于 ESM（`"type": "module"`）
- Node.js >= 14.8.0

## 安装

```bash
# 从 npm 安装
npm install -g @fureweb/cronly

# 无需安装直接使用
npx @fureweb/cronly

# 本地开发
git clone https://github.com/fureweb-com/cronly.git
cd cronly
npm link
```

全局安装后，运行命令仍然是 `cronly`。

## 使用方法

### 注册脚本

```bash
# 每天 2:00 运行
cronly add ./backup.sh --daily 02:00

# 每 10 分钟运行
cronly add ./report.mjs --every-minutes 10

# 周一、三、五 9:00 运行
cronly add ./class.mjs --days mon,wed,fri --at 09:00

# 周末 10:00 运行
cronly add ./weekend-job.mjs --weekends --at 10:00

# 开机时运行一次
cronly add ./startup.sh --reboot

# 显式指定运行时
cronly add ./custom-binary --daily 08:00 --runtime exec
```

`--runtime` 也可以指定其他解释器的名称或路径（例如 `--runtime python3`）。执行 `add` 时会解析为绝对路径并记录，因此 cron 也能找到它。选项可以写成 `--daily 08:00` 或 `--daily=08:00`。

对同一文件再次执行 `add` 时，**以更新而非新增方式运行**：

```bash
# 首次：注册
cronly add ./backup.sh --daily 02:00

# 再次：更改调度（不会重复注册）
cronly add ./backup.sh --daily 03:00
```

### 简易调度模式

| 标志 | 示例 | cron 转换结果 |
|------|------|--------------|
| `--daily HH:MM` | `--daily 08:00` | `0 8 * * *` |
| `--every-hours N` | `--every-hours 4` | `0 */4 * * *` |
| `--every-minutes N` | `--every-minutes 10` | `*/10 * * * *` |
| `--weekly 星期 --at HH:MM` | `--weekly mon --at 10:00` | `0 10 * * 1` |
| `--days 星期,... --at HH:MM` | `--days mon,wed,fri --at 09:00` | `0 9 * * 1,3,5` |
| `--weekdays --at HH:MM` | `--weekdays --at 08:30` | `30 8 * * 1-5` |
| `--weekends --at HH:MM` | `--weekends --at 10:00` | `0 10 * * 0,6` |
| `--reboot` | `--reboot` | `@reboot` |

星期标记：`sun`、`mon`、`tue`、`wed`、`thu`、`fri`、`sat`（不区分大小写）

`--every-hours` 接受 1、2、3、4、6、8、12，`--every-minutes` 接受 1、2、3、4、5、6、10、12、15、20、30。cron 会在每天（小时）或每小时（分钟）重新计数 `*/N`，其他值无法按固定间隔重复。如果仍然需要，请使用 `--schedule`。

### Cron expression 直接输入（高级）

以上模式无法覆盖的场景，可以用 `--schedule` 直接指定：

```bash
# 周一至周三每 6 小时
cronly add ./report.mjs --schedule "0 */6 * * 1-3"

# 每月 15 日 9:00
cronly add ./monthly.mjs --schedule "0 9 15 * *"
```

### 查看列表

```bash
cronly list
```

输出示例：
```
  a1b2c3d4  0 2 * * *        /home/user/backup.sh      (sh)
  e5f6a7b8  */10 * * * *     /home/user/report.mjs     (node)
```

### 删除

```bash
# 按文件路径删除
cronly remove ./backup.sh

# 按 id 删除
cronly remove --id a1b2c3d4
```

### 原始输出

```bash
cronly print
```

输出管理中条目的实际 crontab 块。

### 环境检查

```bash
cronly doctor
```

检查 Node.js 版本、`crontab` 命令、crontab 读取权限、每个管理条目的脚本、运行时和日志目录是否仍然存在，以及同一文件是否被重复注册。任何一项失败时以退出码 1 结束。

### macOS 权限对话框

在 macOS 上，没有完全磁盘访问权限的应用修改 crontab 时会弹出权限对话框，`cronly add` 和 `cronly remove` 会一直等待到你作出响应。对话框可能被其他窗口遮挡，因此如果耗时超过几秒，Cronly 会输出提示。若不想看到对话框，请为运行 Cronly 的应用授予完全磁盘访问权限（系统设置 > 隐私与安全性 > 完全磁盘访问权限）。

## 调度任务的运行方式

cron 以最精简的环境启动任务，因此在终端中正常运行的脚本，在 cron 中很容易静默失败。Cronly 会为每个任务做好设置，使其行为更接近手动运行：

- **工作目录**：在脚本所在目录中运行，`.env`、`./config.json` 等相对路径可以正常解析。
- **PATH**：把执行 `cronly add` 的 Node.js 所在目录放在最前面，后接 `/usr/bin:/bin`，因此 shell 脚本中可以调用 `node`、`npm`、`npx`。其他工具请使用绝对路径，或在脚本中设置 `PATH`。
- **日志**：stdout 和 stderr 会追加到 `~/.cronly/logs/<id>.log`。可通过 `CRONLY_HOME` 更改基础目录。日志不会轮转。
- **Node.js 版本**：任务使用注册时的 Node.js 可执行文件运行（例如 nvm 的版本目录）。删除该版本后，`cronly doctor` 会报告问题；请重新执行 `cronly add` 切换到当前版本。

由旧版 Cronly 注册的条目，在重新执行 `cronly add` 之前会保留旧的命令格式。

## 防重复注册机制

1. 将脚本文件规范化为**绝对路径**（`path.resolve`）
2. 使用绝对路径的 **SHA-256 哈希前8个字符**作为去重 id
3. `add` 时会**替换**相同 id 的块，以及指向同一文件的块（相同 inode，例如符号链接或 macOS 上的大小写差异）（upsert）
4. 否则**追加**新块

cron 会按 `add` 时传入的路径运行，因此在 `current -> releases/v2` 这样的符号链接部署结构中，也会一直跟随链接。`remove <file>` 会删除该文件的所有条目。

### crontab 内部格式

```crontab
# 现有手动条目（不做修改）
0 * * * * /usr/bin/some-other-job

# [cronly:begin] id=a1b2c3d4 path=/home/user/backup.sh runtime=sh
0 2 * * * cd '/home/user' && PATH='/usr/local/bin:/usr/bin:/bin' '/bin/sh' '/home/user/backup.sh' >> '/home/user/.cronly/logs/a1b2c3d4.log' 2>&1
# [cronly:end] id=a1b2c3d4
```

使用 `# [cronly:begin]` / `# [cronly:end]` 块包裹，与其他手动条目完全隔离。

## 测试

```bash
npm test
```

## 项目结构

```
├── bin/cronly.mjs             # CLI 入口
├── lib/
│   ├── cli.mjs                # argv 解析
│   ├── commands.mjs           # add/list/remove/print/doctor 实现
│   ├── crontab.mjs            # crontab 读写（child_process）
│   ├── entry.mjs              # 条目构建/解析/去重
│   ├── schedule.mjs           # 调度标志 → cron 表达式转换
│   ├── i18n.mjs               # 语言检测、消息查找
│   └── i18n/                  # 消息和帮助文本（en, ko, ja, zh）
├── test/
│   ├── test.mjs               # 单元测试
│   └── integration.mjs        # 集成测试（实际 crontab）
├── package.json
└── LICENSE
```

## 未来扩展方向

- **dry-run 模式**：使用 `--dry-run` 标志预览更改而不修改 crontab
- **导入/导出**：以 JSON 备份/恢复管理条目
- **日志选项**：自定义日志路径、日志轮转
- **环境变量注入**：设置 cron 执行时的自定义环境变量
- **MAILTO 设置**：每个条目的错误通知邮件设置
- **分组/标签**：按组批量管理条目
- **overlap 防止**：基于 flock 的并发执行防护

## 限制

- 仅支持用户 crontab（`crontab -l` / `crontab -`）
- 不支持 systemd timer 和 `/etc/cron.d`
- 不支持分布式环境（仅限单机）
- 不包含 overlap execution 防止
- 日志会持续追加，不做轮转
- 拒绝超过 999 字节的 cron 命令（Vixie 系 cron 会将其截断）
- 不支持包含换行或 carriage return 字符的路径

## 许可证

MIT
