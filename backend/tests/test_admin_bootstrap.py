from contextlib import contextmanager

import app.auth as auth


def test_startup_preserves_existing_admin_status_and_permissions(monkeypatch) -> None:
    statements = []

    class Result:
        def mappings(self):
            return self

        def first(self):
            return {"password_hash": "already-configured"}

    class Connection:
        def execute(self, statement, parameters=None):
            statements.append(str(statement))
            return Result()

    @contextmanager
    def fake_db():
        yield Connection()

    monkeypatch.setattr(auth, "db", fake_db)
    monkeypatch.setattr(auth, "_ensure_user_permission_columns", lambda conn: None)
    monkeypatch.setattr(auth, "migrate_ledger_import_permission", lambda conn: None)

    auth.ensure_default_admin()
    assert len(statements) == 1
    assert "SELECT password_hash" in statements[0]
