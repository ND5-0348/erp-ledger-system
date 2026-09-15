"""订单号别名与客户经理历史的持久化（H2）。

业务约定：

- 订单号 `A/B/C` 是同一次改号的**别名链**，不是三个订单；C 是当前号，
  主记录保存当前号，历史表同时覆盖当前号，便于用任意一个别名查到同一订单。
- 客户经理 `甲/乙/丙` 是历次交接，丙是现任；允许重复任职（甲→乙→甲 保留三个位置）。
- 缺少变更日期时 `effective_from` 留空，**不编造**生效时间。
- 编号在同一框架内必须映射到唯一订单；历史号与其他订单的当前号或历史号冲突都要阻断，
  不同框架允许同号。
- **历史链只增不减**：新文件只填写当前号或现任时，已确认的历史必须原样保留；
  现任不同、或链条无法证明是包含关系时一律阻断，不静默按文件覆盖、也不按首行取值。
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.engine import Connection

DEFAULT_SOURCE = "legacy_import"


@dataclass(frozen=True)
class ChainMerge:
    """文件链与库内已确认链的合并结果。

    `chain` 为 None 表示合并被阻断，原因在 `reason`；`changed` 表示这次是否需要写库。
    """

    chain: list[str] | None
    reason: str | None = None

    @property
    def blocked(self) -> bool:
        return self.chain is None


def _is_subsequence(short: list[str], long: list[str]) -> bool:
    """short 是否按顺序出现在 long 中（允许中间插入其他元素，保留重复任职）。"""
    iterator = iter(long)
    return all(item in iterator for item in short)


def register_current_number(
    conn: Connection,
    sales_order_id: int,
    order_no: str,
    *,
    source: str = DEFAULT_SOURCE,
) -> bool:
    """普通导入专用：**只在还没有任何别名记录时**登记当前号。

    已经存在别名链时什么都不做——把当前号硬写到某个位置会覆盖已确认的别名，
    而"改变已有当前号"属于改号交接，必须走预检确认流程，普通追加不得自动执行。
    返回是否真的写入。
    """
    number = str(order_no or "").strip()
    if not number:
        return False
    existing = conn.execute(
        text(
            "SELECT COUNT(*) FROM sales_order_number_history WHERE sales_order_id = :sales_order_id"
        ),
        {"sales_order_id": sales_order_id},
    ).scalar()
    if existing:
        return False
    conn.execute(
        text(
            """
            INSERT INTO sales_order_number_history
              (sales_order_id, order_no, history_order, source)
            VALUES
              (:sales_order_id, :order_no, 1, :source)
            """
        ),
        {"sales_order_id": sales_order_id, "order_no": number, "source": source},
    )
    return True


def register_current_manager(
    conn: Connection,
    project_id: int,
    manager_name: str,
    *,
    source: str = DEFAULT_SOURCE,
) -> bool:
    """普通导入专用：只在还没有负责人历史时登记现任。

    已有历史时不动——现任变化属于框架整体交接，不能由普通追加导入悄悄改写。
    返回是否真的写入。
    """
    name = str(manager_name or "").strip()
    if not name:
        return False
    existing = conn.execute(
        text("SELECT COUNT(*) FROM project_manager_history WHERE project_id = :project_id"),
        {"project_id": project_id},
    ).scalar()
    if existing:
        return False
    conn.execute(
        text(
            """
            INSERT INTO project_manager_history
              (project_id, manager_name, history_order, source)
            VALUES
              (:project_id, :manager_name, 1, :source)
            """
        ),
        {"project_id": project_id, "manager_name": name, "source": source},
    )
    return True


def register_order_numbers(
    conn: Connection,
    sales_order_id: int,
    chain: list[str],
    *,
    source: str = DEFAULT_SOURCE,
    prune: bool = False,
) -> list[str]:
    """登记订单号的别名链（含当前号，即最后一个）。

    幂等：同一订单同一顺序位置已有记录时更新为最新解析值。

    **默认 `prune=False`**：业务链路一律只补不删，绝不因为本次文件没写全就把
    已确认的历史别名删掉（删除意味着搜索再也命中不到那个别名）。
    显式传 `prune=True` 只留给"整份文件全量替换"的维护场景，且必须已经有
    完整的、经过一致性校验的链。
    """
    cleaned = [name.strip() for name in chain if str(name).strip()]
    if not cleaned:
        return []
    if not prune:
        # 只补不删：链比库内已确认的更短时，说明调用方没有先做合并，
        # 直接写会覆盖中间位置又留下尾部（例如 [A,B,C] 写成 [A,C] 得到 [A,C,C]）。
        existing = load_order_numbers(conn, sales_order_id)
        if len(cleaned) < len(existing):
            raise ValueError(
                "不允许截短已确认的订单号别名链；"
                "请先用 merge_order_chain 与库内链合并，或显式传 prune=True 做全量替换"
            )
    for index, order_no in enumerate(cleaned, start=1):
        conn.execute(
            text(
                """
                INSERT INTO sales_order_number_history
                  (sales_order_id, order_no, history_order, source)
                VALUES
                  (:sales_order_id, :order_no, :history_order, :source)
                ON DUPLICATE KEY UPDATE order_no = VALUES(order_no), source = VALUES(source)
                """
            ),
            {
                "sales_order_id": sales_order_id,
                "order_no": order_no,
                "history_order": index,
                "source": source,
            },
        )
    if prune:
        # 多余的旧位置（链变短）要清掉，否则搜索会命中已经不存在的别名
        conn.execute(
            text(
                "DELETE FROM sales_order_number_history "
                "WHERE sales_order_id = :sales_order_id AND history_order > :last"
            ),
            {"sales_order_id": sales_order_id, "last": len(cleaned)},
        )
    return cleaned


def register_manager_history(
    conn: Connection,
    project_id: int,
    chain: list[str],
    *,
    source: str = DEFAULT_SOURCE,
    effective_from: object | None = None,
    prune: bool = False,
) -> list[str]:
    """登记客户经理的交接链（最后一个为现任）。允许重复任职。

    与订单号别名同理：默认只补不删，"新文件只填了现任"不能清空已确认的交接历史。
    """
    cleaned = [name.strip() for name in chain if str(name).strip()]
    if not cleaned:
        return []
    if not prune:
        existing = load_manager_history(conn, project_id)
        if len(cleaned) < len(existing):
            raise ValueError(
                "不允许截短已确认的客户经理交接链；"
                "请先用 merge_manager_chain 与库内链合并，或显式传 prune=True 做全量替换"
            )
    for index, manager_name in enumerate(cleaned, start=1):
        conn.execute(
            text(
                """
                INSERT INTO project_manager_history
                  (project_id, manager_name, history_order, effective_from, source)
                VALUES
                  (:project_id, :manager_name, :history_order, :effective_from, :source)
                ON DUPLICATE KEY UPDATE
                  manager_name = VALUES(manager_name),
                  effective_from = VALUES(effective_from),
                  source = VALUES(source)
                """
            ),
            {
                "project_id": project_id,
                "manager_name": manager_name,
                "history_order": index,
                # 没有变更日期就留空，不写 CUREENT 时间冒充生效时间
                "effective_from": effective_from,
                "source": source,
            },
        )
    if prune:
        conn.execute(
            text(
                "DELETE FROM project_manager_history "
                "WHERE project_id = :project_id AND history_order > :last"
            ),
            {"project_id": project_id, "last": len(cleaned)},
        )
    return cleaned


def merge_chain(existing: list[str], incoming: list[str], *, what: str) -> ChainMerge:
    """把文件里给出的链与库内已确认的链合并。

    只允许两种变化：补充缺失的历史、或原样保持；其余一律阻断。

    - 现任（末尾）不同 → 阻断：改号/交接必须走专门的授权流程，普通导入不得
      用"文件最后值"强行覆盖库内现状；
    - 文件链是库链的子序列（例如文件只填了当前号）→ 保留库链，历史不丢；
    - 库链是文件链的子序列 → 采用文件链，补充经验证的缺失历史；
    - 两者互不包含 → 无法证明顺序，阻断交人工确认，不按首行或集合重排。
    """
    if not incoming:
        return ChainMerge(chain=list(existing) or None)
    if not existing:
        return ChainMerge(chain=list(incoming))
    if incoming == existing:
        return ChainMerge(chain=list(existing))
    if incoming[-1] != existing[-1]:
        return ChainMerge(
            chain=None,
            reason=(
                f"{what}的当前值不一致：台账为“{existing[-1]}”，文件为“{incoming[-1]}”。"
                "改变当前值属于改号或整体交接，必须走专门的授权流程，普通导入不执行"
            ),
        )
    if _is_subsequence(incoming, existing):
        # 文件只写了当前值的一部分历史：保留已确认的完整链，不截短。
        return ChainMerge(chain=list(existing))
    if _is_subsequence(existing, incoming):
        return ChainMerge(chain=list(incoming))
    return ChainMerge(
        chain=None,
        reason=(
            f"{what}的历史链与台账不一致：台账为“{'/'.join(existing)}”，"
            f"文件为“{'/'.join(incoming)}”。无法证明先后顺序，请人工确认后重填"
        ),
    )


def existing_order_chain(conn: Connection, sales_order_id: int) -> list[str]:
    """库内该订单的完整别名链：历史表优先，为空时退回主记录当前号。"""
    chain = load_order_numbers(conn, sales_order_id)
    if chain:
        return chain
    current = conn.execute(
        text("SELECT order_no FROM sales_order WHERE id = :id"),
        {"id": sales_order_id},
    ).scalar()
    return [str(current)] if current else []


def existing_manager_chain(conn: Connection, project_id: int) -> list[str]:
    """库内该框架的完整交接链：历史表优先，为空时退回主记录现任。"""
    rows = conn.execute(
        text(
            "SELECT manager_name FROM project_manager_history "
            "WHERE project_id = :project_id ORDER BY history_order"
        ),
        {"project_id": project_id},
    ).scalars().all()
    chain = [str(row) for row in rows]
    if chain:
        return chain
    current = conn.execute(
        text("SELECT account_manager FROM project WHERE id = :project_id"),
        {"project_id": project_id},
    ).scalar()
    return [str(current)] if current else []


def merge_order_chain(conn: Connection, sales_order_id: int, incoming: list[str]) -> ChainMerge:
    return merge_chain(
        existing_order_chain(conn, sales_order_id), incoming, what="订单号"
    )


def merge_manager_chain(conn: Connection, project_id: int, incoming: list[str]) -> ChainMerge:
    return merge_chain(
        existing_manager_chain(conn, project_id), incoming, what="客户经理"
    )


def load_order_numbers(conn: Connection, sales_order_id: int) -> list[str]:
    rows = conn.execute(
        text(
            "SELECT order_no FROM sales_order_number_history "
            "WHERE sales_order_id = :sales_order_id ORDER BY history_order"
        ),
        {"sales_order_id": sales_order_id},
    ).scalars().all()
    return [str(row) for row in rows]


def load_manager_history(conn: Connection, project_id: int) -> list[dict]:
    rows = conn.execute(
        text(
            """
            SELECT manager_name, history_order, effective_from, source
            FROM project_manager_history
            WHERE project_id = :project_id
            ORDER BY history_order
            """
        ),
        {"project_id": project_id},
    ).mappings().all()
    return [dict(row) for row in rows]


def conflicts_in_project(
    conn: Connection,
    project_id: int,
    order_nos: list[str],
    *,
    exclude_sales_order_id: int | None = None,
) -> dict[str, int]:
    """这些编号在本框架内是否已属于**另一个**订单。

    返回 {编号: 已占用它的订单 id}。当前号与历史号都算占用。
    """
    wanted = [order_no for order_no in dict.fromkeys(order_nos) if str(order_no).strip()]
    if not wanted:
        return {}
    conflicts: dict[str, int] = {}
    for order_no in wanted:
        row = conn.execute(
            text(
                """
                SELECT so.id
                FROM sales_order so
                WHERE so.project_id = :project_id
                  AND so.deleted_at IS NULL
                  AND (:exclude_sales_order_id IS NULL OR so.id <> :exclude_sales_order_id)
                  AND (
                    so.order_no = :order_no
                    OR EXISTS (
                      SELECT 1 FROM sales_order_number_history h
                      WHERE h.sales_order_id = so.id AND h.order_no = :order_no
                    )
                  )
                LIMIT 1
                """
            ),
            {
                "project_id": project_id,
                "order_no": order_no,
                "exclude_sales_order_id": exclude_sales_order_id,
            },
        ).scalar()
        if row:
            conflicts[order_no] = int(row)
    return conflicts


def find_order_by_number(conn: Connection, project_id: int, order_no: str) -> int | None:
    """用当前号或任一历史号定位订单（同一框架内）。"""
    row = conn.execute(
        text(
            """
            SELECT so.id
            FROM sales_order so
            WHERE so.project_id = :project_id
              AND so.deleted_at IS NULL
              AND (
                so.order_no = :order_no
                OR EXISTS (
                  SELECT 1 FROM sales_order_number_history h
                  WHERE h.sales_order_id = so.id AND h.order_no = :order_no
                )
              )
            ORDER BY so.id
            LIMIT 1
            """
        ),
        {"project_id": project_id, "order_no": order_no},
    ).scalar()
    return int(row) if row else None


def manager_candidates(conn: Connection, project_id: int) -> list[str]:
    """当前负责人候选：主记录上的现任 + 历史表里的全部姓名（去重、保序）。"""
    current = conn.execute(
        text("SELECT account_manager FROM project WHERE id = :project_id"),
        {"project_id": project_id},
    ).scalar()
    names: list[str] = []
    if current:
        names.append(str(current))
    for row in conn.execute(
        text(
            "SELECT manager_name FROM project_manager_history "
            "WHERE project_id = :project_id ORDER BY history_order"
        ),
        {"project_id": project_id},
    ).scalars().all():
        if str(row) not in names:
            names.append(str(row))
    return names
