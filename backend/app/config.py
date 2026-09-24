from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


ROOT_DIR = Path(__file__).resolve().parents[2]
BACKEND_DIR = ROOT_DIR / "backend"
DOCS_DIR = ROOT_DIR / "docs"

load_dotenv(BACKEND_DIR / ".env")

# 应用业务备份目录。新文件位于 BACKUP_ROOT/<数据库名>，旧根目录文件只读兼容；
# 测试环境通过 BACKUP_ROOT 指向系统临时目录，避免测试产生的备份混进业务目录。
LEGACY_BACKUP_DIR = Path(os.getenv("BACKUP_ROOT") or (BACKEND_DIR / "backups"))
BACKUP_DIR = LEGACY_BACKUP_DIR / os.getenv("MYSQL_DATABASE", "erp_ledger")


@dataclass(frozen=True)
class Settings:
    mysql_host: str = os.getenv("MYSQL_HOST", "127.0.0.1")
    mysql_port: int = int(os.getenv("MYSQL_PORT", "3306"))
    mysql_user: str = os.getenv("MYSQL_USER", "root")
    mysql_password: str = os.getenv("MYSQL_PASSWORD", "")
    mysql_database: str = os.getenv("MYSQL_DATABASE", "erp_ledger")
    frontend_origin: str = os.getenv("FRONTEND_ORIGIN", "http://127.0.0.1:3000")
    auth_secret: str = os.getenv("AUTH_SECRET", "")
    default_admin_password: str = os.getenv("DEFAULT_ADMIN_PASSWORD", "")

    @property
    def server_url(self) -> str:
        return (
            f"mysql+pymysql://{self.mysql_user}:{self.mysql_password}"
            f"@{self.mysql_host}:{self.mysql_port}?charset=utf8mb4"
        )

    @property
    def database_url(self) -> str:
        return (
            f"mysql+pymysql://{self.mysql_user}:{self.mysql_password}"
            f"@{self.mysql_host}:{self.mysql_port}/{self.mysql_database}?charset=utf8mb4"
        )


settings = Settings()


def validate_security_settings() -> None:
    if len(settings.auth_secret) < 32 or settings.auth_secret == "erp-ledger-local-dev-secret":
        raise RuntimeError("AUTH_SECRET 必须设置为至少 32 位的随机字符串")
    if len(settings.default_admin_password) < 6:
        raise RuntimeError("DEFAULT_ADMIN_PASSWORD 必须设置为至少 6 位密码")
