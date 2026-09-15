"""按数据库隔离的业务写入互斥（Task 2）。

用 MySQL 命名锁 `GET_LOCK` 让同一数据库的业务写请求串行执行：

- 锁名由数据库名的稳定摘要构成，本地库、测试库、生产库互不阻塞；
- 这是**请求事务期间**的短锁，不是用户打开编辑页期间的占用锁；
- 读取完全不取锁，页面浏览与查询不受影响；
- 等待上限 5 秒，超时抛 409 `BUSINESS_WRITE_BUSY`，且不写任何业务数据；
- 锁在同一个数据库连接上获取、释放；释放失败则丢弃该连接，避免连接带着锁回到
  连接池；进程异常退出时由数据库自动释放。

嵌套调用（例如导入内部再调用批量写入的辅助函数）复用外层锁，不重复获取。
"""
from __future__ import annotations

import hashlib
import threading
from contextlib import contextmanager
from typing import Iterator

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.engine import Connection

from .config import settings
from .db import engine

BUSY_STATUS_CODE = 409
BUSY_ERROR_CODE = "BUSINESS_WRITE_BUSY"
BUSY_MESSAGE = "另一笔业务写入正在进行，请稍后重试；本次请求未写入任何数据。"
LOCK_TIMEOUT_SECONDS = 5

_state = threading.local()


def lock_name(database: str | None = None) -> str:
    """锁名带数据库摘要：不同数据库互不阻塞，同一数据库跨进程共享同一把锁。"""
    name = database or settings.mysql_database
    digest = hashlib.sha1(name.encode("utf-8")).hexdigest()[:32]
    return f"erp_ledger_write_{digest}"  # 49 字符，短于 MySQL 的 64 字符上限


def _owns_lock() -> bool:
    return bool(getattr(_state, "depth", 0))


@contextmanager
def business_write() -> Iterator[Connection]:
    """在写入互斥保护下执行一次业务写入，产出一个已开启事务的连接。

    正常退出提交事务，异常回滚事务；两种情况都会释放命名锁。
    """
    depth = getattr(_state, "depth", 0)
    if depth:
        # 嵌套：外层已持锁并开启事务，复用同一连接，避免重复取锁导致自锁。
        _state.depth = depth + 1
        try:
            yield _state.connection
        finally:
            _state.depth = depth
        return

    try:
        connection = engine.connect()
    except TimeoutError as exc:
        # 连接池被等待锁的请求占满时也要给出可识别的“忙”，而不是 500。
        raise HTTPException(
            status_code=BUSY_STATUS_CODE,
            detail={"code": BUSY_ERROR_CODE, "message": BUSY_MESSAGE},
        ) from exc
    locked = False
    try:
        locked = _acquire(connection)
        if not locked:
            raise HTTPException(
                status_code=BUSY_STATUS_CODE,
                detail={"code": BUSY_ERROR_CODE, "message": BUSY_MESSAGE},
            )
        # 取锁的 SELECT 触发了 SQLAlchemy 的 autobegin。先结束这个空事务，
        # 业务事务随后单独开启——避免业务读写快照在取得锁之前就已建立。
        # GET_LOCK 是连接级状态，不受提交/回滚影响。
        connection.commit()

        _state.depth = 1
        _state.connection = connection
        try:
            with connection.begin():
                yield connection
        finally:
            _state.depth = 0
            _state.connection = None
    finally:
        discarded = False
        if locked:
            try:
                if not _release(connection):
                    discarded = True
            except Exception:
                discarded = True
        if discarded:
            # 释放结果未知的连接不能回到池里，否则后续请求会以为已经没人持锁。
            connection.invalidate()
        connection.close()


def _acquire(connection: Connection) -> bool:
    result = connection.execute(
        text("SELECT GET_LOCK(:name, :timeout)"),
        {"name": lock_name(), "timeout": LOCK_TIMEOUT_SECONDS},
    ).scalar()
    return result == 1


def _release(connection: Connection) -> bool:
    result = connection.execute(text("SELECT RELEASE_LOCK(:name)"), {"name": lock_name()}).scalar()
    return result == 1
