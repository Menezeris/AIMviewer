"""ETL configuration - loading `DATABASE_URL` from the environment (D-031).

`DATABASE_URL` is a direct Postgres connection to Supabase (Project Settings ->
Database -> Connection string). Secret - lives in `.env.local`/`.env` (gitignored),
never committed.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# Repo root = one level above etl/. Load both .env.local and .env (if they exist).
_REPO_ROOT = Path(__file__).resolve().parent.parent
for _name in (".env.local", ".env"):
    _path = _REPO_ROOT / _name
    if _path.exists():
        load_dotenv(_path, override=False)


# D-196: every ETL connection carries its source for the transaction log (etl/audit.py).
from etl import audit as _audit  # noqa: E402

_audit.tag_connections()


def database_url() -> str:
    """Return `DATABASE_URL` or fail with an understandable message."""
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit(
            "Chýba DATABASE_URL. Doplň ho do .env.local (Supabase → Project "
            "Settings → Database → Connection string / URI)."
        )
    return url


# Project of an ETL run (D-189): `--project` > env `AIM_PROJECT` > OCB.
DEFAULT_PROJECT = "OCB"


def project_code(cli: str | None = None) -> str:
    """Project code (`IfcProject.Name`, `objects.object_ref` of the project node)."""
    code = (cli or os.environ.get("AIM_PROJECT") or DEFAULT_PROJECT).strip()
    if not code:
        raise SystemExit("Empty project code (--project / AIM_PROJECT).")
    return code


def supabase_url() -> str | None:
    """`SUPABASE_URL` (base of public URLs in Storage), if set."""
    return os.environ.get("SUPABASE_URL") or None


# Public URL of the deployed Viewer - base for URI-link annotations in drawings (D-042 B).
# Environment-specific: override `SITE_URL` in `.env.local` for local/preview; default = production.
_DEFAULT_SITE_URL = "https://ai-mviewer.vercel.app"


def site_url() -> str:
    """Return `SITE_URL` (without a trailing `/`); default = production Vercel URL."""
    return os.environ.get("SITE_URL", _DEFAULT_SITE_URL).rstrip("/")
