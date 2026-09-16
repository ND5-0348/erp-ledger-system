# Task 1 验收证据：整表导入独立权限与部门边界

- 日期：2026-09-15
- 分支：`codex/dashboard-filter-timezone`，本阶段起点 `57ea1b8`（Task 0）
- MySQL 5.7.44（本地 Docker）。原始 pytest 输出在本目录，属运行日志，**不提交**。

## 1. 差异

| 文件 | 变更 |
| --- | --- |
| `backend/app/auth.py` | `ALL_PERMISSIONS` 新增 `ledger_import`；新增 `migrate_ledger_import_permission()` 并在 `ensure_default_admin()` 中调用 |
| `backend/app/routers/auth.py` | 新增权限中文名；`UserCreate`/`UserPermissionUpdate` 增加 `department_all`；新增 `_validate_import_department_policy()`；`_list_users` 返回 `effective_permissions` |
| `backend/app/routers/orders.py` | `POST /api/orders/import-excel` 权限 `order_entry` → `ledger_import` |
| `backend/app/importer.py` | 新增 `SHARED_PROJECT_FIELDS` 与 `_find_shared_field_conflicts()`；已有项目不再被 `ON DUPLICATE KEY UPDATE` 改写共享字段 |
| `backend/tests/test_import_permissions.py` | **新增**，18 个用例 |
| `backend/tests/test_financial_integration.py` | 部门边界用例的账号补上 `ledger_import`（否则被权限层拦下，测不到部门校验） |
| `src/lib/permissions.ts` | 新权限、`standardRoleFor`、`permissionRoleLabel` |
| `src/components/SystemScreen.tsx` | 角色列按实际权限显示；导入账号部门策略；编辑老账号用 `effective_permissions` |
| `src/components/OrdersScreen.tsx`、`src/App.tsx` | 导入按钮改用 `canImportLedger` |
| `src/api.ts` | 用户接口类型补 `department_all`、`effective_permissions` |
| `tests/permissions.test.ts` | 补充新权限与角色标签用例 |

### 1.1 迁移

- **权限点**：`ledger_import`（中文“整表导入（含采购及销售财务数据）”）。管理员角色默认包含；
  其余 4 个角色默认不含；可按账号单独授予。
- **账号数据**：`migrate_ledger_import_permission()` 在应用启动时运行，可重复执行：
  仅对 `permissions_json` 显式包含 `system_admin` 的账号追加新权限；
  普通账号不动；`NULL`（继承角色默认）与 `[]`（显式空权限）都保持原样。
- **无 schema 变更**，无数据删除；维护替换入口（`POST /api/import/excel`）权限仍为 `system_admin`。

## 2. 失败反例

| 反例 | 用例 | 结果 |
| --- | --- | --- |
| 只有 `order_entry` 的账号上传整表 | `test_order_entry_only_account_cannot_import` | **403**，`order_line`/`project` 均 0 行 |
| 无任何权限的账号直接调 API（绕过前端按钮） | `test_account_without_any_permission_cannot_import` | **403** |
| 甲部门账号拿乙部门项目编号、把部门填成甲部门 | `test_cross_department_project_code_cannot_be_reused` | **403**；原项目行与明细数完全不变 |
| 一行的部门不属于账号范围 | `test_department_outside_scope_fails_the_whole_batch` | **403**，整批 0 行 |
| 借新增明细改写项目的分公司 | `test_shared_project_fields_cannot_be_rewritten_by_plain_import` | **422**，提示“分公司（台账为…，Excel 为…）”，原项目不变 |
| 同一批内同项目共享字段自相矛盾 | `test_same_batch_inconsistent_shared_fields_are_rejected` | **422**，整批 0 行 |
| 非管理员导入账号未给部门策略 | `test_ledger_import_account_requires_explicit_department_policy` | **400**，提示需勾选“全部部门” |

## 3. 关键过程：真实业务文件回归推翻了初版字段范围

初版把 `department / branch_company / account_manager / team_level3_name /
customer_unit_name / end_user_name / regional_platform` **七个字段**都当作项目级共享字段。

用真实业务台账（`2026市场部业务台账_已填充_已去重.xlsx`，独立验证库 `erp_ledger_test_verify_task1`，
用完即 drop，未触碰 `erp_ledger`）回归，结果：

```
导入结果：成功 318 行，失败 169 行
第 4 行项目 AH24000060-01 已在台账中，以下项目级共享字段与台账不一致：客户单位为“…”（台账）与“…”（Excel）
```

**169 行被误拦，全部因为“客户单位”。** 于是对真实文件做了字段稳定性统计
（`profile_shared_fields.py`，25 个项目、19 个多明细项目）：

| 字段 | 同一项目编号下出现多值的项目数 | 占比 | 结论 |
| --- | --- | --- | --- |
| department 部门 | 0 | 0.0% | 保留校验 |
| branch_company 分公司 | 0 | 0.0% | 保留校验 |
| team_level3_name 三级团队 | 0 | 0.0% | 保留校验 |
| regional_platform 区域平台 | 0 | 0.0% | 保留校验 |
| account_manager 客户经理 | 1 | 5.3% | **剔除** |
| end_user_name 最终用户 | 2 | 10.5% | **剔除** |
| customer_unit_name 客户单位 | 6 | 31.6% | **剔除** |
| project_name 项目名称 | 7 | 36.8% | **剔除**（已知明细级） |

这四类字段描述的是**明细对应的终端客户与代理**，同项目编号下本就会不同，属于合法的明细级差异。

收窄后同一文件回归：**成功 487 行，失败 0 行**，项目 25 / 订单 91 / 明细 487，与既有验收口径一致。
新增用例 `test_line_level_differences_are_still_allowed` 固定这一边界。

## 4. 验收证据

### 4.1 测试结果

| 项目 | 结果 |
| --- | --- |
| 后端全量 | `2 failed, 128 passed, 1 skipped`（失败项仍为既有的 `N-05`、`B-05`） |
| 新增用例 | `test_import_permissions.py` 18 个全通过 |
| 前端 | 12 个测试文件全通过；`npm run lint`(tsc) 与 `npm run build` 退出码 0 |
| 备份目录隔离 | 跑完整套件前后 `backend/backups/*.json.gz` 均为 **75**，未新增 |

### 4.2 真实文件回归（独立验证库，非业务库）

```
样本：2026市场部业务台账_已填充_已去重.xlsx（160695 字节）
入库：project 25 / sales_order 91 / order_line 487 / purchase_info 487
失败 0 行；验证库用完即销毁
```

### 4.3 未完成 / 未验证

- **浏览器交互验收未做**。需要真实登录业务库，本阶段只做了类型检查、构建与纯逻辑测试；
  双浏览器人工验收按计划安排在 Task 7。
- 未在 MySQL 8.4 上验证（本地 5.7.44）。
- `N-05`、`B-05` 仍是既有失败，未修复。
- 部门字段的跨批次一致性校验尚未在真实“已有项目 + 新明细追加”场景下演练
  （用例覆盖的是合成数据）。
