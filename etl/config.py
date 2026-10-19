"""Konfigurácia ETL — načítanie `DATABASE_URL` z prostredia (D-031).

`DATABASE_URL` je priame Postgres pripojenie na Supabase (Project Settings →
Database → Connection string). Tajné — žije v `.env.local`/`.env` (gitignored),
nikdy sa necommituje.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# Repo root = o úroveň vyššie ako etl/. Načítaj .env.local aj .env (ak existujú).
_REPO_ROOT = Path(__file__).resolve().parent.parent
for _name in (".env.local", ".env"):
    _path = _REPO_ROOT / _name
    if _path.exists():
        load_dotenv(_path, override=False)


def database_url() -> str:
    """Vráti `DATABASE_URL` alebo zrozumiteľne zlyhá."""
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit(
            "Chýba DATABASE_URL. Doplň ho do .env.local (Supabase → Project "
            "Settings → Database → Connection string / URI)."
        )
    return url


def supabase_url() -> str | None:
    """`SUPABASE_URL` (báza verejných URL v Storage), ak je nastavené."""
    return os.environ.get("SUPABASE_URL") or None


# Verejná URL nasadeného Viewera — báza pre URI-link anotácie vo výkresoch (D-042 B).
# Env-špecifická: prepíš `SITE_URL` v `.env.local` pre lokál/preview; default = produkcia.
_DEFAULT_SITE_URL = "https://ai-mviewer.vercel.app"


def site_url() -> str:
    """Vráti `SITE_URL` (bez koncového `/`); default = produkčná Vercel URL."""
    return os.environ.get("SITE_URL", _DEFAULT_SITE_URL).rstrip("/")
