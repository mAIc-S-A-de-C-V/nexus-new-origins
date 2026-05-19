"""
Capability scope catalog.

Scopes are dot-separated: `domain:action:target`. Target supports wildcard "*".
A scope is granted by tenant admin during install — granted is a subset of required.

Each scope maps to one or more RPC methods. The RPC dispatcher refuses any
method whose required scope isn't in the install's granted set.

Reference: ontology:read:*, ontology:read:ordenes_de_compra, actions:propose:*,
storage:kv:read, storage:kv:write, host:refresh.
"""
from __future__ import annotations
from dataclasses import dataclass


@dataclass(frozen=True)
class ScopeDef:
    name: str                  # canonical scope string
    description: str
    sensitive: bool = False    # admin install UI should highlight


# Canonical scope catalog. Additive only — once a scope ships, its name and
# semantics are frozen so installed apps don't break.
CATALOG: list[ScopeDef] = [
    # Ontology — read
    ScopeDef("ontology:read:*",            "Read all object types",                  sensitive=True),
    ScopeDef("ontology:read:<type>",       "Read records of one object type"),
    ScopeDef("ontology:list_types",        "List which object types exist"),
    ScopeDef("ontology:aggregate:*",       "Run aggregate queries (any type)",       sensitive=True),
    ScopeDef("ontology:aggregate:<type>",  "Run aggregate queries (one type)"),
    # Ontology — write (direct row write via apps RPC; or via actions for workflows)
    ScopeDef("ontology:create:*",          "Create records of any object type",      sensitive=True),
    ScopeDef("ontology:create:<type>",     "Create records of one object type"),
    ScopeDef("ontology:update:*",          "Update records of any object type",      sensitive=True),
    ScopeDef("ontology:update:<type>",     "Update records of one object type"),
    ScopeDef("ontology:delete:*",          "Delete records of any object type",      sensitive=True),
    ScopeDef("ontology:delete:<type>",     "Delete records of one object type"),
    ScopeDef("actions:list",               "See which actions exist"),
    ScopeDef("actions:propose:*",          "Propose execution of any action",        sensitive=True),
    ScopeDef("actions:propose:<name>",     "Propose execution of one action"),
    # Agents
    ScopeDef("agents:list",                "See which agents exist"),
    ScopeDef("agents:run:*",               "Trigger any agent",                      sensitive=True),
    ScopeDef("agents:run:<name>",          "Trigger one specific agent"),
    # Workflow / queues
    ScopeDef("workflow:read:my",           "Read this user's workflow assignments"),
    ScopeDef("workflow:read:all",          "Read all tenant workflow assignments",   sensitive=True),
    # KV storage
    ScopeDef("storage:kv:read",            "Read app-owned key/value data"),
    ScopeDef("storage:kv:write",           "Write app-owned key/value data"),
    # Host helpers
    ScopeDef("host:refresh",               "Mint a new short-lived token"),
    ScopeDef("host:config:read",           "Read this install's config"),
    # Events / subscriptions
    ScopeDef("events:subscribe:*",         "Subscribe to live ontology events",      sensitive=True),
]


def is_template(scope: str) -> bool:
    return "<" in scope and ">" in scope


def template_for(scope: str) -> str | None:
    """If `scope` looks like 'ontology:read:foo', return matching template 'ontology:read:<type>'."""
    parts = scope.split(":")
    if len(parts) != 3:
        return None
    # try matching against catalog templates with the same first two parts
    prefix = ":".join(parts[:2])
    for s in CATALOG:
        if not is_template(s.name):
            continue
        if s.name.startswith(prefix + ":") and s.name.count(":") == 2:
            return s.name
    return None


def is_known(scope: str) -> bool:
    """Accept either a literal catalog entry or a concrete instance of a template."""
    if any(s.name == scope for s in CATALOG):
        return True
    return template_for(scope) is not None


def scope_matches(required: str, granted_list: list[str]) -> bool:
    """
    Does any scope in `granted_list` satisfy `required`?

    Wildcards match more specific targets:
      granted = "ontology:read:*"  satisfies  required = "ontology:read:vendors"
      granted = "ontology:read:vendors" only satisfies the exact target.
    """
    req_parts = required.split(":")
    for g in granted_list:
        g_parts = g.split(":")
        if len(g_parts) != len(req_parts):
            continue
        ok = True
        for rp, gp in zip(req_parts, g_parts):
            if gp == "*" or gp == rp:
                continue
            ok = False
            break
        if ok:
            return True
    return False


# Method → required scope mapping. RPC dispatcher consults this.
METHOD_SCOPES: dict[str, str] = {
    # Ontology
    "ontology.listTypes":    "ontology:list_types",
    "ontology.get":          "ontology:read:*",     # type-specific check at dispatch time
    "ontology.query":        "ontology:read:*",     # ditto
    "ontology.aggregate":    "ontology:aggregate:*",
    "ontology.create":       "ontology:create:*",
    "ontology.update":       "ontology:update:*",
    "ontology.delete":       "ontology:delete:*",
    # Actions
    "actions.list":          "actions:list",
    "actions.propose":       "actions:propose:*",
    # Agents
    "agents.list":           "agents:list",
    "agents.run":            "agents:run:*",
    # Workflow
    "workflow.listMine":     "workflow:read:my",
    "workflow.listAll":      "workflow:read:all",
    # KV
    "storage.kv.get":        "storage:kv:read",
    "storage.kv.list":       "storage:kv:read",
    "storage.kv.set":        "storage:kv:write",
    "storage.kv.delete":     "storage:kv:write",
    # Host
    "host.refreshToken":     "host:refresh",
    "host.getConfig":        "host:config:read",
    "host.ping":             "",                    # always allowed
    # Events (poll-based subscribe falls back to repeated query calls)
    "events.subscribe":      "events:subscribe:*",
}


def required_scope_for(method: str, target: str | None = None) -> str | None:
    """
    Returns the most specific scope required for a method, optionally narrowed
    by a target (object type name, action name, agent name).

    Returns None if the method requires no scope (e.g. host.ping).
    """
    base = METHOD_SCOPES.get(method)
    if base is None:
        raise ValueError(f"Unknown method: {method}")
    if base == "":
        return None
    # If method allows targeted scoping, build the concrete form
    if target and base.endswith(":*"):
        return base[:-1] + target
    return base


def validate_scope_list(scopes: list[str]) -> list[str]:
    """Returns the subset that aren't known. Empty list = all valid."""
    return [s for s in scopes if not is_known(s)]
