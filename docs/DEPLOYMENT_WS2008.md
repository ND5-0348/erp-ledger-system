# ERP 台账系统 — Windows Server 2008 SP2 部署指南

## 一、兼容性分析

| 组件 | 开发环境版本 | WS2008 SP2 兼容版本 | 兼容性 |
|------|-------------|-------------------|--------|
| Python | 3.8.5 | **3.8.10**（最后支持 WS2008 的版本） | 兼容 |
| MySQL | 8.0 | **5.7.44**（最后支持 WS2008 的版本） | 兼容（需 5.7.6+） |
| Node.js | 22+ | **不支持** | 不在服务器上运行 |
| Vite/React | 6.x/19.x | **不支持** | 在开发机上构建后部署静态文件 |
| Nginx | — | 1.24.0 (Windows build) | 可选，推荐 |

> **关键策略**：前端在开发机上 `npm run build` 生成静态文件，服务器只运行 Python 后端 + MySQL 数据库。服务器端无需安装 Node.js。

---

## 二、所需材料清单

### 2.1 软件安装包（提前下载到 U 盘或共享目录）

| 序号 | 材料 | 下载地址 | 说明 |
|------|------|----------|------|
| 1 | Python 3.8.10 | `https://www.python.org/ftp/python/3.8.10/python-3.8.10-amd64.exe` | Windows x64 安装包 |
| 2 | MySQL 5.7.44 | `https://downloads.mysql.com/archives/installer/` | 选 `mysql-installer-community-5.7.44.0.msi` |
| 3 | Visual C++ 2015-2019 Redist | `https://aka.ms/vs/17/release/vc_redist.x64.exe` | Python/MySQL 运行依赖 |
| 4 | Nginx 1.24.0 (可选) | `https://nginx.org/download/nginx-1.24.0.zip` | 如不用 FastAPI 自托管前端，可选用 |

### 2.2 项目文件

| 序号 | 材料 | 来源 | 说明 |
|------|------|------|------|
| 5 | 后端代码 | 当前项目的 `backend/` 目录 | 包含 `app/`、`requirements.txt` |
| 6 | 前端构建产物 | `npm run build` 生成的 `dist/` 目录 | 在开发机上构建 |
| 7 | 数据库建表脚本 | `docs/erp_ledger_schema.sql` | 建库建表 |
| 8 | 台账 Excel 文件 | `2026年市场部业务台账.xlsx` | 业务数据源 |

### 2.3 服务器环境信息（需提前确认）

| 项目 | 需确认内容 |
|------|-----------|
| 服务器 IP 地址 | 固定 IP 或内网 IP |
| 端口开放 | 3000（前端）、8001（后端 API）或仅开放 8001（合并部署） |
| 防火墙 | 需放行上述端口入站规则 |
| 磁盘空间 | 至少 2GB 可用空间（系统 + 数据） |
| 管理员权限 | 安装软件需要 |

---

## 三、部署步骤

### 步骤 1：在开发机上构建前端

```powershell
# 在开发机项目根目录执行
cd E:\project\erp-ledger-system-main
npm install
npm run build
# 产物在 dist\ 目录，将此目录整个拷贝到服务器
```

### 步骤 2：服务器基础环境安装

**2.1 安装 Visual C++ Redist**

```
执行 vc_redist.x64.exe → 按向导完成安装 → 重启
```

**2.2 安装 Python 3.8.10**

```
执行 python-3.8.10-amd64.exe
  ✓ Add Python 3.8 to PATH
  ✓ Install for all users
  安装路径: C:\Python38
```

验证：
```cmd
python --version
:: Python 3.8.10
```

**2.3 安装 MySQL 5.7.44**

```
执行 mysql-installer-community-5.7.44.0.msi
  选择: Server only
  Config Type: Development Computer
  端口: 3306
  Root 密码: 设置复杂密码（牢记）
  ✓ Install as Windows Service (服务名: MySQL57)
  ✓ Start MySQL at System Startup
```

验证：
```cmd
mysql -u root -p
Enter password: ****
mysql> SELECT VERSION();
:: 5.7.44
```

### 步骤 3：创建数据库并初始化

```cmd
mysql -u root -p < E:\deploy\erp_ledger_schema.sql
```

验证：
```cmd
mysql -u root -p
mysql> USE erp_ledger;
mysql> SHOW TABLES;
:: 应显示: project, sales_order, order_line, purchase_info, delivery_record,
::         purchase_contract, purchase_invoice, warehouse_entry,
::         finance_invoice_check, purchase_payment, finance_payment_entry,
::         sales_contract, sales_invoice, sales_receipt,
::         import_batch, ledger_raw_row, erp_user, operation_log, backup_record
```

### 步骤 4：部署后端代码

**4.1 拷贝文件**

在服务器上创建目录结构：
```
E:\erp-ledger\
  ├── backend\
  │   ├── app\
  │   │   ├── main.py
  │   │   ├── config.py
  │   │   ├── db.py
  │   │   ├── auth.py
  │   │   ├── audit.py
  │   │   ├── importer.py
  │   │   ├── serializers.py
  │   │   ├── validation.py
  │   │   └── routers\
  │   │       ├── auth.py
  │   │       ├── dashboard.py
  │   │       ├── ledgers.py
  │   │       ├── orders.py
  │   │       ├── purchases.py
  │   │       ├── sales.py
  │   │       └── system.py
  │   ├── requirements.txt
  │   ├── .env
  │   └── backups\
  ├── frontend\          ← 这里放 dist\ 的内容
  │   ├── index.html
  │   ├── assets\
  │   └── ...
  └── docs\
      ├── erp_ledger_schema.sql
      └── 2026年市场部业务台账.xlsx
```

**4.2 配置环境变量**

编辑 `E:\erp-ledger\backend\.env`：

```ini
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=你设置的MySQL密码
MYSQL_DATABASE=erp_ledger
FRONTEND_ORIGIN=http://127.0.0.1:8001
AUTH_SECRET=随机生成至少32位字符串
DEFAULT_ADMIN_PASSWORD=初始管理员密码
```

生成 `AUTH_SECRET`（在开发机上执行）：
```powershell
python -c "import secrets; print(secrets.token_hex(32))"
```

**4.3 安装 Python 依赖**

```cmd
cd E:\erp-ledger\backend
python -m pip install --upgrade pip
pip install -r requirements.txt
:: 如果 pip 在线安装失败，提前在开发机上下载离线包:
:: pip download -r requirements.txt -d E:\offline_packages
:: 将 offline_packages 目录拷贝到服务器
:: pip install --no-index --find-links=E:\offline_packages -r requirements.txt
```

### 步骤 5：配置前端静态文件服务

**修改 `E:\erp-ledger\backend\app\main.py`**，在文件末尾的 `@app.get("/api/health")` 之后添加：

```python
import os
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "frontend")
FRONTEND_DIR = os.path.abspath(FRONTEND_DIR)

if os.path.isdir(FRONTEND_DIR):
    assets_dir = os.path.join(FRONTEND_DIR, "assets")
    if os.path.isdir(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        """Serve frontend SPA — all non-API routes return index.html."""
        file_path = os.path.join(FRONTEND_DIR, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        index_path = os.path.join(FRONTEND_DIR, "index.html")
        if os.path.isfile(index_path):
            return FileResponse(index_path)
        return JSONResponse(status_code=404, content={"detail": "Not found"})
```

同时在文件头部添加 `JSONResponse` 导入（合并到已有的 `from fastapi.responses import JSONResponse`）。

这样一来前端和后端合并部署在一个端口（8001），无需单独的 Nginx。

### 步骤 6：启动服务

**6.1 手动启动测试**

```cmd
cd E:\erp-ledger\backend
python -m uvicorn app.main:app --host 127.0.0.1 --port 8001
```

浏览器访问 `http://127.0.0.1:8001`，应看到登录页面。用 `.env` 中配置的 `DEFAULT_ADMIN_PASSWORD` 登录。

**6.2 注册为 Windows 服务（开机自启）**

方式一 — 使用 `nssm`（推荐）：

```cmd
:: 下载 nssm.exe 放到 C:\Windows\System32\
nssm install ERP_Ledger
:: 在弹出的 GUI 中配置:
::   Application Path: C:\Python38\python.exe
::   Arguments: -m uvicorn app.main:app --host 127.0.0.1 --port 8001
::   Startup Directory: E:\erp-ledger\backend
::   Service Name: ERP_Ledger
::   Start: Auto

nssm start ERP_Ledger
```

方式二 — 使用 `sc` 命令（需要 `pywin32` 且较复杂，不展开）。

---

## 四、台账数据导入

### 方式一：通过 Web 界面导入（推荐）

1. 登录系统（admin / 初始密码）
2. 进入「系统管理」→「数据导入」
3. 点击「选择文件」→ 选择 `2026年市场部业务台账.xlsx`
4. 点击「导入」
5. 等待导入完成，查看成功/失败行数
6. 进入「台账管理」页面验证数据

### 方式二：通过 API 导入

```powershell
# 1. 先登录获取 token
$body = @{username="admin";password="admin123"} | ConvertTo-Json
$resp = Invoke-RestMethod -Uri "http://127.0.0.1:8001/api/auth/login" `
  -Method POST -ContentType "application/json" -Body $body
$token = $resp.access_token

# 2. 确认 Excel 文件在 docs 目录下
# 文件命名必须匹配: 2026*.xlsx

# 3. 触发导入
$headers = @{Authorization="Bearer $token"}
Invoke-RestMethod -Uri "http://127.0.0.1:8001/api/orders/import" `
  -Method POST -Headers $headers
```

### 方式三：启动时自动导入

如果 `.env` 文件所在目录的 `../docs/` 下有 `2026*.xlsx` 文件，且数据库 `order_line` 表为空，系统启动时会自动导入。详见 `backend/app/importer.py:93`。

### 台账 Excel 文件要求

| 要求 | 说明 |
|------|------|
| 文件名 | 必须匹配 `2026*.xlsx`（如 `2026年市场部业务台账.xlsx`） |
| 工作表 | 第 3 个工作表（索引 2，即 `供应链公司业务2026`） |
| 表头行 | 第 3 行 |
| 数据起始行 | 第 5 行 |
| 字段映射 | 按列位映射，详见 `docs/MySQL建表设计.md` 第 11 节 |
| 重复字段 | 一期/二期付款、一期/二期回款按列位+业务分组解析 |

### 导入验证清单

导入完成后，按以下步骤验证数据：

| 序号 | 验证项 | 操作 | 预期 |
|------|--------|------|------|
| 1 | 数据行数 | 首页仪表盘查看 `importedRows` | 491 行 |
| 2 | 订单金额 | 仪表盘 `orderAmount` | ~¥12,254,300 |
| 3 | 台账列表 | 进入「台账管理」 | 25 个项目 |
| 4 | 订单详情 | 点击任意订单 | 含货物、金额、采购、交付信息 |
| 5 | 采购详情 | 切换「采购信息」 | 含供应商、合同、付款 |
| 6 | 销售详情 | 切换「销售信息」 | 含合同、开票、回款 |
| 7 | 用户登录 | admin / 初始密码 | 可登录 |
| 8 | 操作日志 | 系统管理 → 操作日志 | 有导入记录 |

---

## 五、MySQL 5.7 兼容性注意事项

某些 SQL 语法需要微调：

### 5.1 视图中 JSON 函数

`v_order_line_finance` 等视图如果包含 `JSON_EXTRACT` 等函数，MySQL 5.7 支持 `JSON_EXTRACT` 但不支持 `->>` 简写语法。需检查并替换：

```sql
-- MySQL 8.0+ 语法
v.raw_row->>'$.field_name'
-- MySQL 5.7 兼容写法
JSON_UNQUOTE(JSON_EXTRACT(v.raw_row, '$.field_name'))
```

### 5.2 `GROUP BY` 与 `ONLY_FULL_GROUP_BY`

MySQL 5.7 默认启用 `ONLY_FULL_GROUP_BY` 模式，视图中 SELECT 的非聚合列必须出现在 GROUP BY 中。当前建表脚本中的视图已兼容此模式。

---

## 六、故障排查

| 现象 | 可能原因 | 解决 |
|------|----------|------|
| `python` 命令不可用 | 未勾选 Add to PATH | 重新安装 Python 并勾选，或手动添加到系统 PATH |
| `pip install` 连接超时 | 服务器无外网 | 在开发机上 `pip download` 后离线安装 |
| `mysql` 无法连接 | MySQL 服务未启动 | `net start MySQL57` |
| 导入后数据为空 | Excel 文件不在 `docs/` 目录 | 检查文件路径和命名 `2026*.xlsx` |
| `AUTH_SECRET` 不足 32 位 | `.env` 中 AUTH_SECRET 太短 | 用 `secrets.token_hex(32)` 生成 |
| 前端页面空白 | `dist/` 未拷贝或路径不对 | 检查 `frontend/` 目录是否有 `index.html` |
| 端口被占用 | CLodopPrint32 等占用 8000 | 改用 8001 端口 |
| `api/ledgers` 报错 | 视图语法不兼容 MySQL 5.7 | 按 5.1 节修改视图 SQL |

---

## 七、部署检查清单

| 阶段 | 检查项 | 状态 |
|------|--------|------|
| 准备 | VC++ Redist 已安装 | [ ] |
| 准备 | Python 3.8.10 已安装、`python --version` 正常 | [ ] |
| 准备 | MySQL 5.7 已安装、服务已启动 | [ ] |
| 准备 | 前端 `npm run build` 已完成 | [ ] |
| 部署 | 数据库 `erp_ledger` 已创建、表结构已导入 | [ ] |
| 部署 | 后端代码已拷贝到 `E:\erp-ledger\backend\` | [ ] |
| 部署 | `.env` 已按服务器环境修改 | [ ] |
| 部署 | `pip install -r requirements.txt` 成功 | [ ] |
| 部署 | 前端 `dist/` 已拷贝到 `E:\erp-ledger\frontend\` | [ ] |
| 部署 | `main.py` 已添加静态文件托管代码 | [ ] |
| 部署 | Excel 台账文件已放入 `E:\erp-ledger\docs\` | [ ] |
| 验证 | `http://127.0.0.1:8001` 可访问登录页 | [ ] |
| 验证 | admin 登录成功 | [ ] |
| 验证 | 台账导入成功、数据行数 = 491 | [ ] |
| 验证 | 仪表盘 KPI 金额与 Excel 一致 | [ ] |
| 验证 | 已配置 Windows 服务自启 | [ ] |
