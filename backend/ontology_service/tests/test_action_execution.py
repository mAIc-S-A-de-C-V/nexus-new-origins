"""
Unit tests for the action write-execution helpers.

We cover the pure logic that doesn't need a database:
  · _render_payload — `$inputs.<path>` token substitution
  · _format_error   — HTTPException vs generic exception formatting
  · _execute_writes — op dispatch + also_writes recursion, with an in-memory
                       fake session that records what the helper *would* do.

The integration path (real Postgres, real ontology rows) is covered by
scripts/smoke_action_writes.sh against a running stack.
"""
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from routers.actions import (
    _execute_writes,
    _format_error,
    _get_path,
    _render_payload,
)


# ── _render_payload ───────────────────────────────────────────────────────


def test_render_payload_exact_match_preserves_type():
    out = _render_payload({"amount": "$inputs.amount"}, {"amount": 42})
    assert out == {"amount": 42}
    assert isinstance(out["amount"], int)


def test_render_payload_substring_interpolates_as_string():
    out = _render_payload({"label": "deal-$inputs.id"}, {"id": "abc"})
    assert out == {"label": "deal-abc"}


def test_render_payload_missing_path_yields_empty_string_in_interpolation():
    out = _render_payload({"label": "x-$inputs.missing-y"}, {})
    assert out == {"label": "x--y"}


def test_render_payload_missing_path_exact_match_yields_none():
    out = _render_payload({"v": "$inputs.missing"}, {})
    assert out == {"v": None}


def test_render_payload_nested_dict_and_list_recursion():
    template = {
        "kind": "deal_created",
        "ref": {"id": "$inputs.id", "tags": ["$inputs.tag", "static"]},
    }
    out = _render_payload(template, {"id": "d-1", "tag": "hot"})
    assert out == {
        "kind": "deal_created",
        "ref": {"id": "d-1", "tags": ["hot", "static"]},
    }


def test_render_payload_dot_path_resolves_nested_inputs():
    out = _render_payload({"owner": "$inputs.contact.email"}, {"contact": {"email": "a@b"}})
    assert out == {"owner": "a@b"}


def test_render_payload_non_token_values_pass_through_unchanged():
    template = {"n": 1, "b": True, "s": "plain", "lst": [1, 2]}
    assert _render_payload(template, {"foo": "bar"}) == template


def test_get_path_returns_none_for_non_dict_intermediate():
    assert _get_path({"a": 5}, "a.b.c") is None


# ── _format_error ─────────────────────────────────────────────────────────


def test_format_error_http_exception_includes_status_and_detail():
    assert _format_error(HTTPException(status_code=400, detail="bad")) == "HTTP 400: bad"


def test_format_error_generic_exception_includes_type_name():
    assert _format_error(ValueError("oops")) == "ValueError: oops"


# ── _execute_writes (with a fake AsyncSession) ────────────────────────────
#
# The helper only needs db.execute(...).scalar_one_or_none(), db.add(...),
# and db.delete(...). We script those without touching SQLAlchemy.


class _FakeResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _FakeSession:
    """Minimal AsyncSession stand-in.

    `lookup_responses` is a FIFO list of values to return from
    scalar_one_or_none() across successive db.execute() calls. The helper
    issues two queries per write: one for ObjectTypeRow, one for the
    existing ObjectRecordRow. For also_writes recursion the pair repeats.
    """

    def __init__(self, lookup_responses):
        self._lookup_responses = list(lookup_responses)
        self.added = []
        self.deleted = []

    async def execute(self, _stmt):
        if not self._lookup_responses:
            return _FakeResult(None)
        return _FakeResult(self._lookup_responses.pop(0))

    def add(self, row):
        self.added.append(row)

    async def delete(self, row):
        self.deleted.append(row)


def _ot_row(ot_id="ot-deal", name="crm_deal"):
    return SimpleNamespace(id=ot_id, tenant_id="t1", name=name)


def _existing_record(source_id, data):
    """Mimics an ObjectRecordRow for the existing-record code paths."""
    row = MagicMock()
    row.source_id = source_id
    row.data = data
    return row


# ── no writes_to_object_type → short-circuit ──────────────────────────────


@pytest.mark.asyncio
async def test_execute_writes_no_writes_to_object_type_short_circuits():
    db = _FakeSession([])
    action = SimpleNamespace(writes_to_object_type=None, also_writes=None)
    out = await _execute_writes(db, "t1", action, {"foo": "bar"})
    assert out["no_write"] is True
    assert out["applied"] == {"foo": "bar"}
    assert out["_post_commit"] == []
    assert db.added == [] and db.deleted == []


# ── create paths ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_execute_writes_create_generates_id_when_missing():
    db = _FakeSession([_ot_row(), None])  # ot lookup, no existing record
    action = SimpleNamespace(writes_to_object_type="ot-deal", also_writes=None)
    out = await _execute_writes(db, "t1", action, {"name": "Acme"})
    assert out["op"] == "create"
    assert out["object_type_id"] == "ot-deal"
    assert out["record_id"] and len(out["record_id"]) >= 8  # uuid
    assert out["applied"]["id"] == out["record_id"]
    assert out["applied"]["name"] == "Acme"
    # Two post-commit callables: emit_record_event + cache invalidate.
    assert len(out["_post_commit"]) == 2
    assert len(db.added) == 1


@pytest.mark.asyncio
async def test_execute_writes_create_uses_provided_id():
    db = _FakeSession([_ot_row(), None])
    action = SimpleNamespace(writes_to_object_type="ot-deal", also_writes=None)
    out = await _execute_writes(db, "t1", action, {"id": "deal-7", "name": "Acme"})
    assert out["record_id"] == "deal-7"
    assert db.added[0].source_id == "deal-7"


@pytest.mark.asyncio
async def test_execute_writes_create_strips_op_from_persisted_data():
    db = _FakeSession([_ot_row(), None])
    action = SimpleNamespace(writes_to_object_type="ot-deal", also_writes=None)
    out = await _execute_writes(db, "t1", action, {"id": "d-1", "op": "create", "x": 1})
    assert "op" not in out["applied"]
    assert "op" not in db.added[0].data


# ── update / merge ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_execute_writes_update_replaces_existing_data():
    existing = _existing_record("d-1", {"id": "d-1", "name": "old", "extra": "keep?"})
    db = _FakeSession([_ot_row(), existing])
    action = SimpleNamespace(writes_to_object_type="ot-deal", also_writes=None)
    out = await _execute_writes(db, "t1", action, {"id": "d-1", "op": "update", "name": "new"})
    assert out["op"] == "update"
    # Replace semantics — old `extra` field is gone.
    assert existing.data == {"id": "d-1", "name": "new"}


@pytest.mark.asyncio
async def test_execute_writes_merge_preserves_unspecified_fields():
    existing = _existing_record("d-1", {"id": "d-1", "name": "old", "extra": "keep"})
    db = _FakeSession([_ot_row(), existing])
    action = SimpleNamespace(writes_to_object_type="ot-deal", also_writes=None)
    out = await _execute_writes(db, "t1", action, {"id": "d-1", "op": "merge", "name": "new"})
    assert out["op"] == "merge"
    assert existing.data == {"id": "d-1", "name": "new", "extra": "keep"}


# ── delete ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_execute_writes_delete_without_id_raises_400():
    db = _FakeSession([_ot_row()])
    action = SimpleNamespace(writes_to_object_type="ot-deal", also_writes=None)
    with pytest.raises(HTTPException) as exc:
        await _execute_writes(db, "t1", action, {"op": "delete"})
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_execute_writes_delete_missing_record_raises_404():
    db = _FakeSession([_ot_row(), None])  # ot exists, record doesn't
    action = SimpleNamespace(writes_to_object_type="ot-deal", also_writes=None)
    with pytest.raises(HTTPException) as exc:
        await _execute_writes(db, "t1", action, {"id": "d-missing", "op": "delete"})
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_execute_writes_delete_removes_existing_record():
    existing = _existing_record("d-1", {"id": "d-1", "name": "Acme"})
    db = _FakeSession([_ot_row(), existing])
    action = SimpleNamespace(writes_to_object_type="ot-deal", also_writes=None)
    out = await _execute_writes(db, "t1", action, {"id": "d-1", "op": "delete"})
    assert out["op"] == "delete"
    assert db.deleted == [existing]


# ── missing object type ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_execute_writes_unknown_object_type_raises_400():
    db = _FakeSession([None])  # ot lookup returns nothing
    action = SimpleNamespace(writes_to_object_type="ot-ghost", also_writes=None)
    with pytest.raises(HTTPException) as exc:
        await _execute_writes(db, "t1", action, {"name": "x"})
    assert exc.value.status_code == 400
    assert "ot-ghost" in exc.value.detail


# ── also_writes recursion ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_execute_writes_also_writes_renders_template_and_recurses():
    """Two creates: primary deal + secondary event_log row referencing it."""
    db = _FakeSession([
        _ot_row(ot_id="ot-deal", name="crm_deal"), None,           # primary
        _ot_row(ot_id="ot-evt", name="crm_event_log"), None,       # secondary
    ])
    action = SimpleNamespace(
        writes_to_object_type="ot-deal",
        also_writes=[{
            "object_type": "ot-evt",
            "payload_template": {"kind": "deal_created", "deal_id": "$inputs.id"},
            "payload_static": {"source": "smoke"},
        }],
    )
    out = await _execute_writes(db, "t1", action, {"id": "d-1", "name": "Acme"})
    assert out["op"] == "create"
    assert len(out["secondary_writes"]) == 1
    sec = out["secondary_writes"][0]
    assert sec["object_type_id"] == "ot-evt"
    assert sec["applied"]["kind"] == "deal_created"
    assert sec["applied"]["deal_id"] == "d-1"
    assert sec["applied"]["source"] == "smoke"
    # Secondary should not recurse further.
    assert sec["secondary_writes"] == []
    # post_commit collected from BOTH writes (2 callbacks each).
    assert len(out["_post_commit"]) == 4
    # Both records were added to the session.
    assert len(db.added) == 2


@pytest.mark.asyncio
async def test_execute_writes_also_writes_uses_generated_id_in_template():
    """When the caller didn't provide an id, the secondary template should
    still resolve `$inputs.id` to the auto-generated source_id."""
    db = _FakeSession([
        _ot_row(ot_id="ot-deal", name="crm_deal"), None,
        _ot_row(ot_id="ot-evt", name="crm_event_log"), None,
    ])
    action = SimpleNamespace(
        writes_to_object_type="ot-deal",
        also_writes=[{
            "object_type": "ot-evt",
            "payload_template": {"deal_id": "$inputs.id"},
        }],
    )
    out = await _execute_writes(db, "t1", action, {"name": "Acme"})
    primary_id = out["record_id"]
    assert out["secondary_writes"][0]["applied"]["deal_id"] == primary_id


@pytest.mark.asyncio
async def test_execute_writes_secondary_failure_propagates():
    """If the secondary target ot doesn't exist, the whole call must raise so
    the caller's savepoint rolls back the primary too."""
    db = _FakeSession([
        _ot_row(ot_id="ot-deal", name="crm_deal"), None,  # primary succeeds
        None,                                              # secondary ot lookup fails
    ])
    action = SimpleNamespace(
        writes_to_object_type="ot-deal",
        also_writes=[{"object_type": "ot-ghost", "payload_template": {}}],
    )
    with pytest.raises(HTTPException) as exc:
        await _execute_writes(db, "t1", action, {"name": "Acme"})
    assert exc.value.status_code == 400
