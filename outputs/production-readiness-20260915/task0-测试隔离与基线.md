# Task 0 验收证据：基线确认与测试隔离

- 日期：2026-09-15
- 分支：`codex/dashboard-filter-timezone`
- 本阶段改动前 HEAD：`3348badd73d4a02c0faf221294d75bfa42f1ae75`
- 工作树：`git worktree list` 仅 `D:/GitHub_WorkSpace/erp-ledger-system`，无额外工作树
- 本地 MySQL：**5.7.44**（Docker `erp-ledger-mysql`，`127.0.0.1:3306`）。生产计划为 MySQL 8.4，
  版本差异对命名锁、`GET_LOCK` 语义的影响必须在 Task 2 单独验证，不能直接用 5.7 结论代替 8.4。
- 原始 pytest 输出保存在本目录 `baseline-pytest-before-task0.txt`、`task0-pytest-after.txt`、
  `task0-negative-*.txt`，属运行日志，**不提交**。

## 1. 基线核对（改动前）

| 项目 | 结果 |
| --- | --- |
| 分支 | `codex/dashboard-filter-timezone`，领先 `fork/codex/dashboard-filter-timezone` 2 个提交 |
| HEAD | `3348bad` 仪表盘移除指标卡上写死的趋势标记 |
| 历史修复 | `db77bc6`（AIGC 尾行 + 判重键补数量/单价/采购厂商）、`e78550c`（北京时间 + 筛选联动）均在 |
| 工作区未跟踪 | `.claude/`、`SESSION.md`、业务 `.xlsx`、`*.err` 日志、`docs/superpowers/` —— 按要求保留、不提交 |

## 2. 改动前的真实问题（改造理由）

跑基线时实测到两个此前只被推断的现象：

1. **测试与业务共用备份目录**。跑基线测试前 `backend/backups/` 有 66 个 `.json.gz`；跑完一次基线
   变成 **75 个**，新增 9 个 `erp_ledger_pre_import_20260915_0946xx.json.gz`。这些文件来自
   `erp_ledger_test_*` 测试库的导入用例，而它们在磁盘上与业务备份无法区分 —— 即现状调查
   `B-5`（66 文件 / 13 记录）的直接成因，本次实测复现。
2. **集成测试依赖外部环境变量才能跑通**。不带 `DEFAULT_ADMIN_PASSWORD` 直接运行时，
   51 个用例在 `headers` 夹具处 401 失败（新库的 admin 密码来自 `.env`，与用例常量不一致），
   而不是清晰的环境错误。

## 3. 差异（本阶段文件清单）

| 文件 | 变更 |
| --- | --- |
| `backend/tests/conftest.py` | **新增**。测试环境安全断言 + 建库/清库/`client`/`headers` 夹具 |
| `backend/tests/test_test_isolation.py` | **新增**。14 个隔离与安全用例 |
| `backend/tests/test_financial_integration.py` | 删除本地常量与 4 个夹具（-84 行），改为使用 conftest 夹具 |
| `backend/app/config.py` | `BACKUP_DIR` 支持 `BACKUP_ROOT` 环境变量，默认值不变 |
| `backend/.env.example` | 补充 `BACKUP_ROOT` 说明 |

### 3.1 迁移与兼容性

- **数据库**：无 schema 变更、无数据迁移。测试库名默认 `erp_ledger_test_readiness_20260915`，
  仍可用 `MYSQL_DATABASE` 覆盖（必须以 `erp_ledger_test_` 开头）。会话结束照旧 `DROP DATABASE`。
- **夹具依赖链**：`client` → `clean_database` → `mysql_test_database`（会话级）。
  建库与删库整个过程只发生一次；不再有 autouse 夹具在文件级重复初始化。
  `test_financial_integration.py` 的全部 21 个测试都声明了 `client`，行为与改造前一致。
- **纯单元测试**（`test_datetime_serialization.py`、`test_order_identity.py`、`test_schema_metadata.py`
  等使用 SQLite / monkeypatch 的用例）现在完全不触碰 MySQL，数据库不可用时仍可单独运行。
- **备份目录**：默认仍为 `backend/backups`，**既有 75 个文件未移动、未删除**，恢复读取路径不变。
  仅当显式设置 `BACKUP_ROOT` 时才改变落盘位置。
- **环境变量时序**：`app.config` 在导入时固化 `Settings` 与 `BACKUP_DIR`，因此 conftest 在导入
  任何 `app.*` 之前设置 `MYSQL_DATABASE`/`BACKUP_ROOT`/`DEFAULT_ADMIN_PASSWORD`。
  `DEFAULT_ADMIN_PASSWORD` 由测试显式覆盖，保证登录用例的密码来源唯一。

## 4. 失败反例（危险配置必须在连接之前被拒绝）

三条反例均以 `PYTHONIOENCODING=utf-8 ... pytest backend/tests/test_datetime_serialization.py -q` 执行，
**退出码 4（pytest usage error），0 个用例被收集、0 次数据库连接**：

| 反例 | 命令要点 | 结果 |
| --- | --- | --- |
| 1. 目标是业务库 | `MYSQL_DATABASE=erp_ledger` | `RuntimeError: 拒绝启动测试：数据库名必须以 'erp_ledger_test_' 开头，当前为 'erp_ledger'` |
| 2. 备份目录指向业务目录 | `BACKUP_ROOT=backend/backups` | `RuntimeError: 拒绝启动测试：备份目录必须位于系统临时目录 C:\Users\shelt\AppData\Local\Temp 之下，当前为 ...\backend\backups` |
| 3. 证明未尝试连接 | 反例 1 再加 `MYSQL_PORT=1`（端口不可达） | 仍报**同一条配置拒绝**错误，而非连接/超时错误 → 断言先于任何连接 |

反例 3 是关键证据：如果代码先连库再检查，端口 1 必然先抛 `OperationalError`。

用例层面另有 `test_test_isolation.py` 的 14 个断言，其中 8 个是**不建立连接的纯函数用例**，
覆盖 `erp_ledger`/`erp_ledger_prod`/空名/无前缀、以及 `backend/backups`/仓库根目录。

## 5. 验收证据（当前环境实测）

### 5.1 测试结果对比

| 时间点 | 结果 | 说明 |
| --- | --- | --- |
| 改造前基线 | `2 failed, 96 passed, 1 skipped` in 76.30s | 失败项：`N-05`、`B-05` |
| 改造后 | `2 failed, 110 passed, 1 skipped` in 71.44s | 新增 14 个隔离用例；**失败项完全相同**，无回归 |

`N-05`（采购付款第二期 `due_payment_date`）与 `B-05` 是**既有失败**，本次未削弱断言、未修改其代码，
按计划"已有失败单独记录"，留待后续排查。

执行命令（仓库根目录）：

```powershell
$env:MYSQL_DATABASE = 'erp_ledger_test_readiness_20260915'
.\backend\.venv\Scripts\python.exe -m pytest backend/tests -q -p no:cacheprovider
```

### 5.2 备份目录隔离实测

| 检查 | 结果 |
| --- | --- |
| 跑基线测试前 `backend/backups/*.json.gz` | 66 |
| 跑完基线测试后 | **75**（+9，污染发生） |
| 改造后跑完整套件前后 | 75 → **75**（0 新增） |
| 测试产生的备份落点 | `C:\Users\shelt\AppData\Local\Temp\erp-ledger-readiness-20260915\`，共 11 个文件 |
| 用例 `test_business_backup_directory_is_untouched_by_test_backups` | 通过（比对文件集合前后一致） |

### 5.3 测试库生命周期

- 套件结束后 `SHOW DATABASES`：只剩 `erp_ledger`，`erp_ledger_test_readiness_20260915` 已被删除。
- 用例 `test_connected_database_is_the_test_database` 断言 `SELECT DATABASE()` 返回测试库名。

## 6. 未完成 / 未验证项

- 未在 MySQL 8.4 上验证（本地为 5.7.44）。命名锁、generated column、`information_schema` 行为
  在 8.4 上需在 Task 2/3 补测或由部署环境复核，不能以 5.7 结果代替。
- `N-05`、`B-05` 两个既有失败**仍未修复**，也未定位到根因。
- 本阶段只让备份**根目录**可配置。按数据库隔离目录、备份清单与完整性校验、
  v1 备份兼容读取、孤儿文件盘点命令属于 Task 5，尚未实施。
- 未运行前端测试与 `npm run build`（本阶段无前端改动）；Task 1 起随改动一起跑。
- 未做两万条压力演练、未做真实恢复演练（Task 6/7）。
- `outputs/` 证据目录中的原始 pytest 日志未提交，仅 markdown 证据随本阶段提交。
