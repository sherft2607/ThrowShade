import os

import psycopg
from psycopg.rows import dict_row

# Postgres only (Render). Queries use `?` placeholders, rewritten to `%s` by
# PgConnection. Fail at startup rather than on the first request if the
# connection string is missing.
DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is not set; point it at the Postgres database.")

IntegrityError = psycopg.IntegrityError

# No REFERENCES clauses: visits and want-to-visit rows point at places that
# mostly live only in the frontend's static data (app/data.js, app/wikidata.js),
# so foreign keys would reject them.
SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    handle TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    bio TEXT
);

CREATE TABLE IF NOT EXISTS places (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL DEFAULT 'building',
    name TEXT NOT NULL,
    architect TEXT,
    year INTEGER,
    typology TEXT,
    style TEXT,
    city TEXT,
    country TEXT,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    address TEXT,
    osm TEXT,
    qid TEXT,
    image TEXT,
    credit TEXT,
    blurb TEXT,
    wiki TEXT,
    source TEXT DEFAULT 'seed',
    added_by TEXT,
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS visits (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    place_id TEXT NOT NULL,
    stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
    note TEXT,
    likes TEXT,
    photos TEXT,
    visited_on TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (user_id, place_id)
);

CREATE TABLE IF NOT EXISTS follows (
    follower_id TEXT NOT NULL,
    followee_id TEXT NOT NULL,
    PRIMARY KEY (follower_id, followee_id)
);

CREATE TABLE IF NOT EXISTS want_to_visit (
    user_id TEXT NOT NULL,
    place_id TEXT NOT NULL,
    created_at TEXT,
    PRIMARY KEY (user_id, place_id)
);

CREATE TABLE IF NOT EXISTS lists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS list_members (
    list_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    PRIMARY KEY (list_id, user_id)
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS private BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    place_id TEXT NOT NULL,
    image TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    visit_user_id TEXT NOT NULL,
    place_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS game_results (
    user_id TEXT NOT NULL,
    day INTEGER NOT NULL,
    guesses INTEGER NOT NULL,
    won BOOLEAN NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS hearts (
    visit_user_id TEXT NOT NULL,
    place_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (visit_user_id, place_id, user_id)
);

CREATE TABLE IF NOT EXISTS stories (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    place_id TEXT,
    image TEXT NOT NULL,
    caption TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS list_items (
    list_id TEXT NOT NULL,
    place_id TEXT NOT NULL,
    added_by TEXT,
    created_at TEXT,
    PRIMARY KEY (list_id, place_id)
);
"""


class PgConnection:
    """Gives a psycopg connection the `execute(sql, params)` interface the
    route handlers use, translating `?` placeholders to `%s`."""

    def __init__(self, conn):
        self._conn = conn

    def execute(self, sql: str, params=()):
        return self._conn.execute(sql.replace("?", "%s"), params)

    def commit(self) -> None:
        self._conn.commit()

    def rollback(self) -> None:
        self._conn.rollback()

    def close(self) -> None:
        self._conn.close()


def get_connection() -> PgConnection:
    return PgConnection(psycopg.connect(DATABASE_URL, row_factory=dict_row))


def init_db() -> None:
    conn = get_connection()
    try:
        for statement in SCHEMA.split(";"):
            if statement.strip():
                conn.execute(statement)
        conn.commit()
    finally:
        conn.close()
