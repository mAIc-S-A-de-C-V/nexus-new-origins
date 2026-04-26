"""
Tests for the EAV (entity-attribute-value) pattern detector that drives the
AI dashboard generator's prompt augmentation.

The detector should:
  - Recognize sensor / metric-stream data and emit guidance to the AI
  - NOT misfire on conventional wide-format tables (one row = one entity
    with all its fields)
"""
import pytest

from claude_client import _detect_eav_pattern, _eav_prompt_section


# ── EAV / long-format positive cases ────────────────────────────────────────


def test_detects_sensor_eav():
    rows = [
        {"sensor_name": "Rajadora_3", "time": "2026-04-26T13:51:18Z", "field": "temp",    "value": "49.4"},
        {"sensor_name": "Rajadora_3", "time": "2026-04-26T13:51:48Z", "field": "temp",    "value": "53.3"},
        {"sensor_name": "Rajadora_3", "time": "2026-04-26T13:51:18Z", "field": "running", "value": "1"},
        {"sensor_name": "Rajadora_3", "time": "2026-04-26T13:51:48Z", "field": "running", "value": "1"},
        {"sensor_name": "Cepilladora_1", "time": "2026-04-26T13:51:18Z", "field": "rpm",  "value": "1500"},
        {"sensor_name": "Cepilladora_1", "time": "2026-04-26T13:51:48Z", "field": "rpm",  "value": "1620"},
    ]
    eav = _detect_eav_pattern(rows)
    assert eav is not None
    assert eav["attribute_col"] == "field"
    assert eav["value_col"] == "value"
    assert set(eav["metrics"]) == {"temp", "running", "rpm"}


def test_detects_with_metric_column_name():
    rows = [
        {"id": "a", "metric_name": "cpu", "value": "78"},
        {"id": "a", "metric_name": "memory", "value": "12.5"},
        {"id": "a", "metric_name": "disk", "value": "44"},
        {"id": "b", "metric_name": "cpu", "value": "55"},
        {"id": "b", "metric_name": "memory", "value": "9.1"},
    ]
    eav = _detect_eav_pattern(rows)
    assert eav is not None
    assert eav["attribute_col"] == "metric_name"
    assert eav["value_col"] == "value"


def test_detects_with_reading_column():
    rows = [
        {"device": "x", "type": "humidity", "reading": "45"},
        {"device": "x", "type": "pressure", "reading": "1013"},
        {"device": "x", "type": "temperature", "reading": "21.5"},
        {"device": "y", "type": "humidity", "reading": "60"},
        {"device": "y", "type": "pressure", "reading": "1011"},
    ]
    eav = _detect_eav_pattern(rows)
    assert eav is not None
    assert eav["attribute_col"] == "type"
    assert eav["value_col"] == "reading"


# ── Negative cases — wide-format / conventional tables ─────────────────────


def test_does_not_misfire_on_wide_format():
    """Classic wide table with all metrics as columns — NOT EAV."""
    rows = [
        {"sensor_name": "A", "rpm": 1500, "temp": 78,   "running": True,  "time": "2026-01-01"},
        {"sensor_name": "B", "rpm": 1600, "temp": 80,   "running": True,  "time": "2026-01-01"},
        {"sensor_name": "C", "rpm": 1450, "temp": 76,   "running": False, "time": "2026-01-01"},
        {"sensor_name": "A", "rpm": 1520, "temp": 79,   "running": True,  "time": "2026-01-02"},
        {"sensor_name": "B", "rpm": 1610, "temp": 81,   "running": True,  "time": "2026-01-02"},
    ]
    assert _detect_eav_pattern(rows) is None


def test_does_not_misfire_on_business_records():
    """CRM / loan / customer records — many fields, no EAV shape."""
    rows = [
        {"id": "1", "borrower": "Alice", "loan_amount": "10000", "status": "approved"},
        {"id": "2", "borrower": "Bob", "loan_amount": "25000",   "status": "pending"},
        {"id": "3", "borrower": "Carol", "loan_amount": "50000", "status": "rejected"},
        {"id": "4", "borrower": "Dan",   "loan_amount": "15000", "status": "approved"},
        {"id": "5", "borrower": "Eve",   "loan_amount": "30000", "status": "approved"},
    ]
    assert _detect_eav_pattern(rows) is None


def test_returns_none_when_too_few_rows():
    rows = [{"field": "rpm", "value": "1500"}]
    assert _detect_eav_pattern(rows) is None


def test_returns_none_when_attribute_has_too_many_distinct_values():
    """1 distinct attribute value in 100 rows isn't EAV — it's just a constant."""
    rows = [{"field": "rpm", "value": str(i)} for i in range(50)]
    eav = _detect_eav_pattern(rows)
    # 1 distinct attribute → fails the 2..30 check
    assert eav is None


# ── Prompt section formatting ─────────────────────────────────────────────


def test_prompt_section_emits_actionable_rules_when_eav_detected():
    rows = [
        {"sensor_name": "A", "field": "rpm",     "value": "1500", "time": "2026-01-01"},
        {"sensor_name": "A", "field": "temp",    "value": "78",   "time": "2026-01-01"},
        {"sensor_name": "A", "field": "running", "value": "1",    "time": "2026-01-01"},
        {"sensor_name": "B", "field": "rpm",     "value": "1600", "time": "2026-01-01"},
        {"sensor_name": "B", "field": "temp",    "value": "80",   "time": "2026-01-01"},
    ]
    section = _eav_prompt_section(rows)
    assert "DETECTED PATTERN" in section
    assert "field" in section
    assert "value" in section
    assert "rpm" in section and "temp" in section and "running" in section
    # Critical rules must be in the section
    assert "MUST add a filter on the attribute column" in section
    assert "NEVER aggregate" in section
    assert "running=1" in section or "method=count" in section


def test_prompt_section_empty_when_not_eav():
    """A wide-format table should produce no EAV section in the prompt."""
    rows = [
        {"id": "1", "name": "A", "score": 90},
        {"id": "2", "name": "B", "score": 85},
        {"id": "3", "name": "C", "score": 78},
        {"id": "4", "name": "D", "score": 92},
        {"id": "5", "name": "E", "score": 88},
    ]
    assert _eav_prompt_section(rows) == ""


def test_prompt_section_empty_when_no_rows():
    assert _eav_prompt_section([]) == ""
    assert _eav_prompt_section(None) == ""  # type: ignore[arg-type]
