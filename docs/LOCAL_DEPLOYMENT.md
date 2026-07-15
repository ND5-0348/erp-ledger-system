# 本地部署运行文档

本文档用于指导其他人在本地从 GitHub 拉取并运行 `erp-ledger-system`。当前已验证环境由 React + Vite 前端、Python 3.8.5 + FastAPI 后端和 MySQL 5.7.21 数据库组成。

## 1. 环境要求

建议使用 Windows + PowerShell 运行，其他系统可按同等命令调整路径。

- Git
- Node.js 20 或更高版本
- Python 3.8.5（当前本机后端运行版本）
- MySQL 5.7.21（当前本机数据库版本）
- 可访问 GitHub 私有仓库的账号权限

检查命令：

```powershell
git --version
node -v
npm -v
C:\Users\asus\AppData\Local\Programs\Python\Python38\python.exe --version
& 'C:\Program Files\MySQL\MySQL Server 5.7\bin\mysql.exe' --version
```

## 2. 拉取代码

```powershell
git clone https://github.com/ND5-0348/erp-ledger-system.git
cd erp-ledger-system
```

如果仓库是私有仓库，先确认当前账号已经具备访问权限。

## 3. 安装前端依赖

```powershell
npm install
```

前端开发服务默认端口是 `3000`，接口请求会通过 Vite 代理转发到后端 `http://127.0.0.1:8001`。

## 4. 安装后端依赖

在项目根目录执行：

```powershell
C:\Users\asus\AppData\Local\Programs\Python\Python38\python.exe -m venv backend\.venv
.\backend\.venv\Scripts\python.exe -m pip install "pip<25"
.\backend\.venv\Scripts\python.exe -m pip install -r backend\requirements-dev.txt
```

当前 MySQL 5.7 使用本地账号认证。依赖中保留 `cryptography`，用于兼容 PyMySQL 的加密认证场景。

## 5. 配置数据库

复制后端环境变量文件：

```powershell
Copy-Item backend\.env.example backend\.env
```

编辑 `backend\.env`：

```ini
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=root
MYSQL_DATABASE=erp_ledger
FRONTEND_ORIGIN=http://127.0.0.1:3000
AUTH_SECRET=至少32位随机字符串
DEFAULT_ADMIN_PASSWORD=admin123
```

要求：

- `MYSQL_USER` 需要有创建数据库、建表、写入数据的权限。
- 当前本机开发账号为 `root/root`，仅用于本地运行；生产环境应改用独立账号。
- 默认管理员账号为 `admin/admin123`；密码至少 6 位，后端保留认证密钥长度校验。
- 不要把 `backend\.env` 提交到 GitHub。
- 数据库可以不用手动创建，后端启动时会执行 `docs/erp_ledger_schema.sql` 初始化 `erp_ledger`。

## 6. 准备业务 Excel 数据

导入程序会读取 `docs` 目录下文件名以 `2026` 开头的 `.xlsx` 文件：

```text
docs\2026年市场部业务台账.xlsx
```

注意：

- 业务 Excel 源文件包含真实业务数据，当前仓库通过 `.gitignore` 排除了 `docs/*.xlsx`。
- 新环境从 GitHub 拉代码后通常没有 Excel 源文件，需要从内部安全渠道取得后放到 `docs` 目录。
- 如果只想查看前端页面结构，可以先启动前端；如果要看真实台账数据，必须准备 Excel 并启动后端导入。

## 7. 初始化数据库并导入数据

首次运行可以直接启动后端，后端只自动初始化 schema，不再自动导入或覆盖业务数据。

也可以手动执行一次初始化和导入：

```powershell
cd backend
@'
from app.db import initialize_schema, db
from app.importer import import_excel

initialize_schema()
with db() as conn:
    print(import_excel(conn, reset=True))
'@ | .\.venv\Scripts\python.exe -
cd ..
```

正常输出会包含 `source_file`、`success_rows`、`failed_rows` 等字段。系统管理接口执行导入前会自动创建备份，发现错误行时整批回滚。命令行直接调用 `reset=True` 仍属于高风险操作，仅允许在明确的测试环境使用。

## 8. 启动后端

方式一：使用 npm 脚本，在项目根目录执行：

```powershell
npm run backend:dev
```

方式二：直接进入后端目录执行：

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8001
```

后端健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:8001/api/health
```

期望结果类似：

```json
{
  "status": "ok",
  "database": "configured",
  "importedRows": 490,
  "error": null
}
```

如果 `status` 是 `degraded`，优先查看 `error` 字段，通常是 MySQL 密码、权限、端口或 Excel 文件缺失问题。

## 9. 启动前端

另开一个 PowerShell 窗口，在项目根目录执行：

```powershell
npm run dev
```

打开：

```text
http://127.0.0.1:3000
```

如果需要改后端代理地址，可以在根目录创建 `.env` 或设置环境变量：

```ini
VITE_API_BASE_URL=/api
VITE_API_PROXY_TARGET=http://127.0.0.1:8001
```

## 10. 构建和检查

提交或发布前建议执行：

```powershell
npm run lint
npm run build
.\backend\.venv\Scripts\python.exe -m compileall backend\app
.\backend\.venv\Scripts\python.exe -m pytest -q
```

说明：

- `npm run lint` 当前执行的是 `tsc --noEmit`，用于检查 TypeScript 编译问题。
- `npm run build` 生成 `dist`，用于验证前端生产构建。
- `compileall` 用于验证后端 Python 文件语法。
- `pytest` 覆盖后端认证、权限、金额校验和关键路由保护。

## 11. 备份与恢复

- 管理员可在系统维护页面创建压缩业务数据备份。
- 备份文件保存在 `backend/backups`，该目录不会提交到 Git。
- 恢复前系统会自动再创建一份 `pre_restore` 快照。
- 恢复仅覆盖业务表，不覆盖账号、权限、操作日志和备份记录。

## 12. 常见问题

### 前端页面打开但没有数据

确认后端已启动，并且健康检查返回 `database: configured`：

```powershell
Invoke-RestMethod http://127.0.0.1:8001/api/health
```

### 后端启动时报 MySQL 连接失败

检查：

- MySQL 服务是否启动。
- `backend\.env` 的账号、密码、端口是否正确。
- MySQL 用户是否有创建数据库和建表权限。
- `backend\.venv` 中是否已安装 `cryptography`。

### 后端提示找不到 Excel 文件

确认 `docs` 目录下存在文件名以 `2026` 开头的 `.xlsx` 文件。业务 Excel 不提交到 GitHub，需要单独放入本地。

### 3000 或 8001 端口被占用

后端可换端口启动：

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8002
```

同时前端代理目标需要改为：

```powershell
$env:VITE_API_PROXY_TARGET="http://127.0.0.1:8002"
npm run dev
```

### 不要提交的本地文件

以下文件只应保留在本地：

- `backend\.env`
- `.env`
- `docs\*.xlsx`
- `backend\.venv\`
- `node_modules\`
- `dist\`
