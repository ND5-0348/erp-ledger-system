from pathlib import Path
from tempfile import TemporaryDirectory

from app.main import _frontend_path


def test_frontend_files_cannot_escape_the_publish_directory() -> None:
    with TemporaryDirectory(prefix="erp-static-audit-") as directory:
        root = Path(directory)
        published = root / "published"
        published.mkdir()
        public_file = published / "index.html"
        public_file.write_text("public", encoding="utf-8")
        private_file = root / "private.txt"
        private_file.write_text("private", encoding="utf-8")

        assert _frontend_path(str(published), "index.html") == public_file
        assert _frontend_path(str(published), "../private.txt") is None
        assert _frontend_path(str(published), str(private_file)) is None
