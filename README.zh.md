# Cronly

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
| 可能重复注册 | 基于绝对路径自动去重 |
| 可能误编辑其他条目 | 仅修改管理块，完全隔离 |
| 难以识别条目 | 通过元数据注释识别 |
| 变更时需手动同步 | `add` 以 upsert 方式运行 |

## 特性

- 零外部 npm 依赖 — 仅使用 Node.js 内置模块
- 无需 DB、服务器或守护进程 — 实际 crontab 是唯一数据源
- 管理条目带有元数据注释，与现有手动条目完全隔离
- 包含空格、单引号和 `%` 的路径会被安全地进行 shell 引用处理
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

检查 Node.js 版本、`crontab` 命令是否存在，以及 crontab 是否可读。

## 防重复注册机制

1. 将脚本文件规范化为**绝对路径**（`path.resolve`）
2. 使用绝对路径的 **SHA-256 哈希前8个字符**作为去重 id
3. `add` 时如果已存在相同 id 的块，则**替换**（upsert）
4. 否则**追加**新块

### crontab 内部格式

```crontab
# 现有手动条目（不做修改）
0 * * * * /usr/bin/some-other-job

# [cronly:begin] id=a1b2c3d4 path=/home/user/backup.sh runtime=sh
0 2 * * * '/bin/sh' '/home/user/backup.sh'
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
│   ├── cli.mjs                # argv 解析、帮助文本
│   ├── commands.mjs           # add/list/remove/print/doctor 实现
│   ├── crontab.mjs            # crontab 读写（child_process）
│   └── entry.mjs              # 条目构建/解析/去重
├── test/
│   ├── test.mjs               # 单元测试
│   └── integration.mjs        # 集成测试（实际 crontab）
├── package.json
└── LICENSE
```

## 未来扩展方向

- **dry-run 模式**：使用 `--dry-run` 标志预览更改而不修改 crontab
- **导入/导出**：以 JSON 备份/恢复管理条目
- **日志路径自动设置**：自动追加 `>> /path/to/log 2>&1` 选项
- **环境变量注入**：设置 cron 执行时的 PATH 等环境变量
- **MAILTO 设置**：每个条目的错误通知邮件设置
- **分组/标签**：按组批量管理条目
- **cron 表达式验证**：预先验证 schedule 值的有效性
- **overlap 防止**：基于 flock 的并发执行防护

## 限制

- 仅支持用户 crontab（`crontab -l` / `crontab -`）
- 不支持 systemd timer 和 `/etc/cron.d`
- 不支持分布式环境（仅限单机）
- 不包含 overlap execution 防止
- 不支持包含换行或 carriage return 字符的路径

## 许可证

MIT
