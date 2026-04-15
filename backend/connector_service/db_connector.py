"""
Database connector module — handles connections to PostgreSQL and MySQL databases.

Provides helpers to connect, list tables, inspect schemas, preview data, and run queries
against external databases configured via connector credentials.
"""
import asyncio
from typing import Any


async def _get_pg_connection(config: dict):
    """Create an asyncpg connection from connector credentials/config."""
    import asyncpg
    host = config.get("host", "localhost")
    port = int(config.get("port", 5432))
    database = config.get("database", "")
    username = config.get("username", "")
    password = config.get("password", "")
    ssl_mode = config.get("ssl")

    kwargs: dict[str, Any] = {
        "host": host,
        "port": port,
        "database": database,
        "user": username,
        "password": password,
    }
    if ssl_mode and ssl_mode not in ("false", "disable"):
        kwargs["ssl"] = "require"

    return await asyncpg.connect(**kwargs)


async def _get_mysql_connection(config: dict):
    """Create an aiomysql connection from connector credentials/config."""
    import aiomysql
    host = config.get("host", "localhost")
    port = int(config.get("port", 3306))
    database = config.get("database", "")
    username = config.get("username", "")
    password = config.get("password", "")

    return await aiomysql.connect(
        host=host,
        port=port,
        db=database,
        user=username,
        password=password,
        autocommit=True,
    )


def _build_db_config(credentials: dict | None, config: dict | None) -> dict:
    """Merge credentials and config into a single dict for connection params."""
    merged: dict[str, Any] = {}
    if credentials:
        merged.update(credentials)
    if config:
        # Connection-specific keys stored in config.connection or config directly
        conn_cfg = config.get("connection") or config
        for key in ("host", "port", "database", "username", "password", "ssl"):
            if key in conn_cfg:
                merged.setdefault(key, conn_cfg[key])
    return merged


# ── PostgreSQL helpers ────────────────────────────────────────────────────────

async def pg_list_tables(config: dict) -> list[dict]:
    conn = await _get_pg_connection(config)
    try:
        rows = await conn.fetch("""
            SELECT schemaname AS schema, tablename AS name,
                   (SELECT reltuples::bigint FROM pg_class
                    WHERE oid = (quote_ident(schemaname) || '.' || quote_ident(tablename))::regclass)
                   AS estimated_rows
            FROM pg_tables
            WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
            ORDER BY schemaname, tablename
        """)
        return [dict(r) for r in rows]
    finally:
        await conn.close()


async def pg_table_schema(config: dict, table_name: str) -> list[dict]:
    conn = await _get_pg_connection(config)
    try:
        rows = await conn.fetch("""
            SELECT c.column_name AS name,
                   c.data_type,
                   (c.is_nullable = 'YES') AS nullable,
                   COALESCE(
                       EXISTS(
                           SELECT 1 FROM information_schema.table_constraints tc
                           JOIN information_schema.key_column_usage kcu
                               ON tc.constraint_name = kcu.constraint_name
                               AND tc.table_schema = kcu.table_schema
                           WHERE tc.constraint_type = 'PRIMARY KEY'
                             AND kcu.table_name = c.table_name
                             AND kcu.column_name = c.column_name
                             AND kcu.table_schema = c.table_schema
                       ), false
                   ) AS is_primary_key
            FROM information_schema.columns c
            WHERE c.table_name = $1
              AND c.table_schema NOT IN ('pg_catalog', 'information_schema')
            ORDER BY c.ordinal_position
        """, table_name)
        return [dict(r) for r in rows]
    finally:
        await conn.close()


async def pg_preview(config: dict, table_name: str, limit: int = 100) -> dict:
    conn = await _get_pg_connection(config)
    try:
        # Validate table_name to prevent injection (alphanumeric, underscores, dots)
        import re
        if not re.match(r'^[a-zA-Z_][a-zA-Z0-9_\.]*$', table_name):
            raise ValueError(f"Invalid table name: {table_name}")
        rows = await conn.fetch(f'SELECT * FROM "{table_name}" LIMIT {int(limit)}')
        if not rows:
            return {"columns": [], "rows": [], "row_count": 0}
        columns = list(rows[0].keys())
        return {
            "columns": columns,
            "rows": [dict(r) for r in rows],
            "row_count": len(rows),
        }
    finally:
        await conn.close()


async def pg_query(config: dict, query: str) -> list[dict]:
    conn = await _get_pg_connection(config)
    try:
        rows = await conn.fetch(query)
        return [dict(r) for r in rows]
    finally:
        await conn.close()


# ── MySQL helpers ─────────────────────────────────────────────────────────────

async def mysql_list_tables(config: dict) -> list[dict]:
    conn = await _get_mysql_connection(config)
    try:
        async with conn.cursor(aiomysql_dict_cursor=True) as cur:
            pass
    except Exception:
        pass
    # Use standard cursor approach
    cur = conn.cursor()
    try:
        db_name = config.get("database", "")
        await cur.execute("""
            SELECT table_name AS name, table_schema AS `schema`,
                   table_rows AS estimated_rows
            FROM information_schema.tables
            WHERE table_schema = %s AND table_type = 'BASE TABLE'
            ORDER BY table_name
        """, (db_name,))
        rows = await cur.fetchall()
        desc = [d[0] for d in cur.description]
        return [dict(zip(desc, r)) for r in rows]
    finally:
        await cur.close()
        conn.close()


async def mysql_table_schema(config: dict, table_name: str) -> list[dict]:
    import aiomysql
    conn = await _get_mysql_connection(config)
    cur = conn.cursor()
    try:
        db_name = config.get("database", "")
        await cur.execute("""
            SELECT column_name AS name, data_type,
                   (is_nullable = 'YES') AS nullable,
                   (column_key = 'PRI') AS is_primary_key
            FROM information_schema.columns
            WHERE table_schema = %s AND table_name = %s
            ORDER BY ordinal_position
        """, (db_name, table_name))
        rows = await cur.fetchall()
        desc = [d[0] for d in cur.description]
        return [dict(zip(desc, r)) for r in rows]
    finally:
        await cur.close()
        conn.close()


async def mysql_preview(config: dict, table_name: str, limit: int = 100) -> dict:
    import re
    if not re.match(r'^[a-zA-Z_][a-zA-Z0-9_\.]*$', table_name):
        raise ValueError(f"Invalid table name: {table_name}")
    conn = await _get_mysql_connection(config)
    cur = conn.cursor()
    try:
        await cur.execute(f"SELECT * FROM `{table_name}` LIMIT {int(limit)}")
        rows = await cur.fetchall()
        desc = [d[0] for d in cur.description] if cur.description else []
        if not rows:
            return {"columns": [], "rows": [], "row_count": 0}
        return {
            "columns": desc,
            "rows": [dict(zip(desc, r)) for r in rows],
            "row_count": len(rows),
        }
    finally:
        await cur.close()
        conn.close()


async def mysql_query(config: dict, query: str) -> list[dict]:
    conn = await _get_mysql_connection(config)
    cur = conn.cursor()
    try:
        await cur.execute(query)
        rows = await cur.fetchall()
        desc = [d[0] for d in cur.description] if cur.description else []
        return [dict(zip(desc, r)) for r in rows]
    finally:
        await cur.close()
        conn.close()


# ── Dispatcher ────────────────────────────────────────────────────────────────

async def list_tables(connector_type: str, config: dict) -> list[dict]:
    if connector_type == "POSTGRESQL":
        return await pg_list_tables(config)
    elif connector_type == "MYSQL":
        return await mysql_list_tables(config)
    raise ValueError(f"Unsupported database connector type: {connector_type}")


async def table_schema(connector_type: str, config: dict, table_name: str) -> list[dict]:
    if connector_type == "POSTGRESQL":
        return await pg_table_schema(config, table_name)
    elif connector_type == "MYSQL":
        return await mysql_table_schema(config, table_name)
    raise ValueError(f"Unsupported database connector type: {connector_type}")


async def preview_table(connector_type: str, config: dict, table_name: str, limit: int = 100) -> dict:
    if connector_type == "POSTGRESQL":
        return await pg_preview(config, table_name, limit)
    elif connector_type == "MYSQL":
        return await mysql_preview(config, table_name, limit)
    raise ValueError(f"Unsupported database connector type: {connector_type}")


async def run_query(connector_type: str, config: dict, query: str) -> list[dict]:
    if connector_type == "POSTGRESQL":
        return await pg_query(config, query)
    elif connector_type == "MYSQL":
        return await mysql_query(config, query)
    raise ValueError(f"Unsupported database connector type: {connector_type}")


async def test_db_connection(connector_type: str, config: dict) -> tuple[bool, str, int]:
    """Test a database connection. Returns (success, message, latency_ms)."""
    import time
    start = time.time()
    try:
        if connector_type == "POSTGRESQL":
            conn = await _get_pg_connection(config)
            await conn.execute("SELECT 1")
            await conn.close()
        elif connector_type == "MYSQL":
            conn = await _get_mysql_connection(config)
            cur = conn.cursor()
            await cur.execute("SELECT 1")
            await cur.close()
            conn.close()
        else:
            return False, f"Unsupported type: {connector_type}", 0
        latency = int((time.time() - start) * 1000)
        return True, "Connection successful", latency
    except Exception as e:
        latency = int((time.time() - start) * 1000)
        return False, f"Connection failed: {str(e)}", latency
