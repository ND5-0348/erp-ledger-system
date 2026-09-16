# Task 2 验收证据：跨入口并发写入保护

- 日期：2026-09-15
- 分支：`codex/dashboard-filter-timezone`，本阶段起点 `9c14361`（Task 1）
- MySQL 5.7.44（本地 Docker）。原始 pytest 输出在本目录，属运行日志，**不提交**。

## 1. 差异

| 文件 | 变更 |
| --- | --- |
| `backend/app/write_guard.py` | **新增**。MySQL 命名锁实现的 `business_write()` 上下文 |
| `backend/app/routers/orders.py` | 6 个写端点接入互斥；导入端点拆出同步函数 `_run_order_import` 并用 `run_in_threadpool` 执行 |
| `backend/app/routers/purchases.py` | 14 个写端点 + `_soft_delete_detail` 接入互斥 |
| `backend/app/routers/sales.py` | 8 个写端点 + `_soft_delete_detail` 接入互斥 |
| `backend/app/routers/system.py` | 维护替换、手动备份、业务恢复接入互斥；补 `except HTTPException: raise` 避免 409 被兜底吞成 500 |
| `backend/tests/test_write_concurrency.py` | **新增**，14 个用例 |
| `src/api.ts` | `parseErrorMessage` 支持结构化 detail（写入忙的 message 直接展示） |
| `tests/write-busy-message.test.ts` | **新增** |

### 1.1 锁的行为约定

- 锁名 `erp_ledger_write_<数据库名 sha1 前 32 位>`（49 字符，短于 MySQL 的 64 上限）。
  本地库、测试库、生产库互不阻塞；同一数据库跨连接池、跨进程共享同一把锁。
- 等待上限 **5 秒**，超时返回 `409 {"detail": {"code": "BUSINESS_WRITE_BUSY", "message": ...}}`，
  且**不写任何业务数据**。
- 这是请求事务期间的短锁，**不覆盖用户打开编辑页面的过程**；读取完全不取锁。
- 取锁在同一个数据库连接上；取锁后先结束 SQLAlchemy 的隐式事务再开启业务事务，
  避免业务读快照早于取锁。异常路径同样释放；释放结果异常时 `invalidate()` 丢弃连接，
  不让带锁的连接回到连接池。
- 嵌套调用复用外层连接，不重复取锁。

## 2. 迁移与兼容

- **无 schema 变更、无数据迁移**。锁是运行时机制，重启即恢复。
- 所有写入端点对外契约不变（成功路径的响应体与状态码未变）；新增的只是并发时的 409。
- 维护替换入口 `POST /api/import/excel` 的**能力未变**（仍是全量清库导入），
  Task 4 再改为预检 + 显式确认 + 事务替换。
- 文件导入端点由 `async def` 内部直接阻塞，改为 `await run_in_threadpool(同步函数)`，
  使单 worker 的事件循环在整份导入期间仍能响应健康检查与其他请求。

## 3. 失败反例

### 3.1 未接入锁时的实际结果（如实记录，不伪造红灯）

先写的 API 层并发用例（两个线程经屏障同时提交**完全相同**的明细）**没有复现重复入库**：
两次请求都返回 200 之前，先到的请求已经提交，后到的被应用层判重拦下（422）。
也就是说这个用例在当前实现下无法可靠打开竞态窗口。**没有据此宣称现状安全**，
而是改用下面的“持锁探测”证明端点确实受同一把锁约束。

### 3.2 持锁时的反例（本阶段新增的硬约束）

| 反例 | 用例 | 结果 |
| --- | --- | --- |
| 一条连接持锁，第二条连接取同一把锁 | `test_two_connections_never_enter_the_critical_section_together` | 0 超时探测返回 **0**（取不到）；持锁线程释放后立即可得 |
| 持锁超过等待上限 | `test_waiting_longer_than_the_timeout_reports_busy` | **409 BUSINESS_WRITE_BUSY** |
| 临界区内抛异常 | `test_lock_is_released_when_the_body_raises` | 锁被释放，下一次写入正常 |
| 嵌套调用 | `test_nested_business_write_reuses_the_same_lock` | 复用同一连接，不自锁 |
| 独立连接池（等价另一个进程） | `test_lock_is_visible_to_an_independent_engine` | 取锁返回 **0** |
| 另一个数据库的锁 | `test_another_databases_lock_does_not_block` | 立即可得，互不阻塞 |
| 持锁时 10 个代表性写端点 | `test_write_endpoints_all_wait_behind_the_lock` | **全部 409**，且明细数不变；锁释放后同样的请求返回 200 |
| 持锁时维护替换 | `test_maintenance_import_uses_the_same_lock` | **409**，原有业务数据一条未删 |
| 持锁时业务恢复 | `test_restore_uses_the_same_lock` | **409** |

## 4. 端点覆盖清单

`test_every_business_write_endpoint_goes_through_the_guard` 解析四个路由文件的 AST，
要求每个 `@router.post/put/delete` 端点的函数体里出现 `business_write`，
或落入显式白名单（白名单本身也由 `test_whitelisted_endpoints_really_call_the_guarded_helper`
核对确实调用了取锁 helper）。当前共检查 **34 个端点，缺失 0 个**。

| 模块 | 直接取锁 | 经取锁 helper 写入 | 只读豁免 |
| --- | --- | --- | --- |
| `orders.py` | 6：单条新增、批量新增、批量新增(基本信息)、批量修改(基本信息)、单条修改、单条删除 | 1：`import_orders_excel` → `_run_order_import` | 2：`batch-editor/schema`、`batch-editor/rows` |
| `purchases.py` | 14：批量修改、汇总修改、合同/发票/入库单/发票核对/财务付款/采购付款 的新增与修改 | 6：上述六类明细的删除 → `_soft_delete_detail` | 1：`batch-editor/rows` |
| `sales.py` | 8：批量修改、合同/发票/回款 的新增与修改、回款删除 | 2：合同、发票删除 → `_soft_delete_detail` | 1：`batch-editor/rows` |
| `system.py` | 3：维护替换、手动备份、业务恢复 | — | — |

**未纳入互斥**：账号管理（`/api/auth/users*`）。理由：`erp_user` 不属于 16 张业务表，
与业务写入没有数据竞争；纳入只会让改密码之类的操作去抢业务写锁。

## 5. 验收证据

| 项目 | 结果 |
| --- | --- |
| 后端全量（连续两次） | `2 failed, 142 passed, 1 skipped`（失败项仍为既有 `N-05`、`B-05`） |
| 新增用例 | `test_write_concurrency.py` 14 个全通过；单独重复运行 3 次稳定 |
| 前端 | `tsc --noEmit` 与 `npm run build` 退出码 0；新增 `write-busy-message.test.ts` 通过 |
| 备份目录隔离 | 跑完整套件前后 `backend/backups/*.json.gz` 均为 **75** |
| 测试现场 | `docs/*.xlsx` 无残留（维护导入用例的占位文件已删除） |

## 6. 未完成 / 未验证

- **未加数据库唯一索引**：判重的竞态现在由互斥锁消除，但表级仍无唯一约束兜底
  （`I-3` 保持未修，符合本阶段“不增加跨表拼接索引”的决定）。
- **连接池容量约束**：等待锁的请求会占住一个池连接（默认 5+10）。并发写请求数超过池容量时
  会走到刚补的 pool-timeout → 409 分支，行为是“忙”而非排队。当前规模（多岗位、低频写）
  未调整池大小，也未做压测。
- 未在 MySQL 8.4 上验证命名锁行为（本地 5.7.44）。
- **未做浏览器多窗口人工验收**，按计划安排在 Task 7。
- 未做两万条规模下“长导入占用写锁”的影响评估（Task 7）。
- `N-05`、`B-05` 仍是既有失败，未修复。
