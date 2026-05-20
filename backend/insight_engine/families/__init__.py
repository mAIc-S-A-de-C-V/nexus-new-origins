"""Family registry. Families register themselves at import time via
@register so the orchestrator can iterate enabled families dynamically.
Phases 4-10 add concrete families; the registry stays empty until then."""
from typing import Callable, Awaitable, Any

_REGISTRY: dict[str, "FamilyEntry"] = {}


class FamilyEntry:
    def __init__(self, name: str, fn, cost_weight: float = 1.0, requires: tuple = ()):
        self.name = name
        self.fn = fn
        self.cost_weight = cost_weight  # relative cost per test (planner uses it)
        self.requires = requires        # tuple of config flag names that must be True


def register(name: str, cost_weight: float = 1.0, requires: tuple = ()):
    def deco(fn):
        _REGISTRY[name] = FamilyEntry(name, fn, cost_weight, requires)
        return fn
    return deco


def all_families() -> dict[str, FamilyEntry]:
    return dict(_REGISTRY)


def enabled_families(cfg) -> dict[str, FamilyEntry]:
    """Return families whose name is in cfg.family_enabled and whose requires
    flags are truthy on cfg."""
    family_enabled = (cfg or {}).get("family_enabled") or {}
    out = {}
    for name, entry in _REGISTRY.items():
        if family_enabled.get(name, True) is False:
            continue
        if any(not (cfg or {}).get(req, False) for req in entry.requires):
            continue
        out[name] = entry
    return out
