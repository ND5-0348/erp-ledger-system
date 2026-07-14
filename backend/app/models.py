from __future__ import annotations

from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import DeclarativeBase, relationship
from sqlalchemy.sql import func


class Base(DeclarativeBase):
    pass


class Project(Base):
    __tablename__ = "project"

    id = Column(Integer, primary_key=True)
    project_code = Column(String(64), unique=True, nullable=False)
    project_name = Column(String(255))
    department = Column(String(64))
    branch_company = Column(String(64))
    account_manager = Column(String(64))
    customer_unit_name = Column(String(255))
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime)

    orders = relationship("SalesOrder", back_populates="project")


class SalesOrder(Base):
    __tablename__ = "sales_order"

    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("project.id"), nullable=False)
    order_no = Column(String(64), nullable=False)
    order_date = Column(Date)
    business_type = Column(String(64))
    statistic_category = Column(String(64))
    close_status = Column(String(32))
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime)

    project = relationship("Project", back_populates="orders")
    lines = relationship("OrderLine", back_populates="sales_order")


class OrderLine(Base):
    __tablename__ = "order_line"

    id = Column(Integer, primary_key=True)
    sales_order_id = Column(Integer, ForeignKey("sales_order.id"), nullable=False)
    goods_name = Column(String(255))
    unit_name = Column(String(32))
    quantity = Column(Numeric(18, 4))
    order_value = Column(Numeric(18, 2))
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime)

    sales_order = relationship("SalesOrder", back_populates="lines")


class OperationLog(Base):
    __tablename__ = "operation_log"

    id = Column(Integer, primary_key=True)
    user_name = Column(String(64))
    module_name = Column(String(64), nullable=False)
    action_name = Column(String(64), nullable=False)
    detail = Column(Text, nullable=False)
    status = Column(String(32), nullable=False)
    created_at = Column(DateTime, server_default=func.now())

