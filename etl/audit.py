"""Who writes: the transaction log settings of an ETL connection (D-196, R12).

The audit triggers record the person (`app.person_id`) and the source (`app.source`) of every write to the
AIM graph. Every ETL connection is tagged through libpq's `PGAPPNAME` (`etl:<script>:<run>`), which the log
uses when `app.source` is not set, so all 26 `psycopg.connect` calls are covered without a change. The main
load also sets both settings explicitly and writes one summary row per run (decision G).

The person comes from `AIM_PERSON_ID` (the IfcPerson node of whoever runs the ETL); until shared sign-in
(step 5) it is usually unset and the log records the database role and the source.
"""

from __future__ import annotations

import os
import re
import sys
import uuid
from pathlib import Path

RUN_ID = uuid.uuid4().hex[:12]
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


def script_name() -> str:
    return Path(sys.argv[0]).stem if sys.argv and sys.argv[0] else "python"


def tag_connections() -> None:
    """Set `PGAPPNAME` for this process unless the caller set one (libpq reads it on connect)."""
    os.environ.setdefault("PGAPPNAME", f"etl:{script_name()}:{RUN_ID}")


def person_id() -> str:
    """`AIM_PERSON_ID` when it is a UUID, else '' (unknown person)."""
    value = (os.environ.get("AIM_PERSON_ID") or "").strip()
    return value if _UUID.match(value) else ""


def set_session(cur, source: str) -> None:
    """Set `app.person_id` and `app.source` for the rest of the connection's transaction."""
    cur.execute(
        "select set_config('app.person_id', %s, true), set_config('app.source', %s, true)",
        (person_id(), source),
    )


def write_run(cur, run: str, summary: dict, project_id: str | None) -> bool:
    """One summary row per run in the transaction log; skipped (False) before the log exists."""
    exists = cur.execute(
        "select to_regprocedure('audit.write_run(text, jsonb, uuid)') is not null"
    ).fetchone()[0]
    if not exists:
        return False
    from psycopg.types.json import Json

    cur.execute("select audit.write_run(%s, %s::jsonb, %s::uuid)", (run, Json(summary), project_id))
    return True
