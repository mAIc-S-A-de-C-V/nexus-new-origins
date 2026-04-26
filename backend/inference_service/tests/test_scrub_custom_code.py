"""
Tests for the safety net that converts AI-generated custom-code widgets
into typed widgets in the dashboard layout response.
"""
from claude_client import _scrub_custom_code_components


def test_passes_through_typed_components_unchanged():
    layout = {
        "app_name": "Test",
        "components": [
            {"id": "c1", "type": "kpi-banner", "title": "Banner"},
            {"id": "c2", "type": "line-chart", "title": "Chart"},
        ],
    }
    out = _scrub_custom_code_components(layout, "ot-1")
    assert out["components"][0]["type"] == "kpi-banner"
    assert out["components"][1]["type"] == "line-chart"


def test_converts_custom_code_to_line_chart_when_title_says_over_time():
    layout = {
        "components": [
            {
                "id": "c1",
                "type": "custom-code",
                "title": "RPM by sensor — last 24 hours",
                "objectTypeId": "ot-1",
                "code": "// stub",
            }
        ]
    }
    out = _scrub_custom_code_components(layout, "ot-1")
    c = out["components"][0]
    assert c["type"] == "line-chart"
    assert c["xField"] == "time"
    assert c["xAxisRange"] == "last_24h"


def test_converts_custom_code_to_pivot_table_for_per_per_per_titles():
    layout = {
        "components": [
            {
                "id": "c1",
                "type": "custom-code",
                "title": "Uptime per sensor per day",
                "objectTypeId": "ot-1",
                "code": "// stub pivot",
            }
        ]
    }
    out = _scrub_custom_code_components(layout, "ot-1")
    c = out["components"][0]
    assert c["type"] == "pivot-table"
    assert c["labelField"] == "sensor_name"
    assert c["timeBucket"] == "day"


def test_converts_custom_code_to_bar_chart_for_ranking_titles():
    layout = {
        "components": [
            {
                "id": "c1",
                "type": "custom-code",
                "title": "Top 10 sensors by activity",
                "objectTypeId": "ot-1",
            }
        ]
    }
    out = _scrub_custom_code_components(layout, "ot-1")
    assert out["components"][0]["type"] == "bar-chart"


def test_converts_custom_code_to_data_table_for_list_titles():
    layout = {
        "components": [
            {
                "id": "c1",
                "type": "custom-code",
                "title": "Recent readings list",
                "objectTypeId": "ot-1",
            }
        ]
    }
    out = _scrub_custom_code_components(layout, "ot-1")
    assert out["components"][0]["type"] == "data-table"


def test_falls_back_to_text_block_for_unrecognized_titles():
    layout = {
        "components": [
            {
                "id": "c1",
                "type": "custom-code",
                "title": "Quantum entanglement visualizer",
                "objectTypeId": "ot-1",
            }
        ]
    }
    out = _scrub_custom_code_components(layout, "ot-1")
    c = out["components"][0]
    assert c["type"] == "text-block"
    assert "isn't allowed" in c["content"]


def test_preserves_existing_filters_and_fields_during_conversion():
    layout = {
        "components": [
            {
                "id": "c1",
                "type": "custom-code",
                "title": "RPM trend over time",
                "objectTypeId": "ot-1",
                "filters": [{"field": "field", "operator": "eq", "value": "rpm"}],
                "labelField": "sensor_name",
                "valueField": "value",
                "timeBucket": "5_minutes",
            }
        ]
    }
    out = _scrub_custom_code_components(layout, "ot-1")
    c = out["components"][0]
    assert c["type"] == "line-chart"
    assert c["filters"] == [{"field": "field", "operator": "eq", "value": "rpm"}]
    assert c["labelField"] == "sensor_name"
    assert c["valueField"] == "value"
    assert c["timeBucket"] == "5_minutes"  # explicit user choice preserved


def test_handles_layout_without_components():
    assert _scrub_custom_code_components({}, "ot-1") == {}
    assert _scrub_custom_code_components({"app_name": "x"}, "ot-1") == {"app_name": "x"}


def test_handles_non_dict_input():
    assert _scrub_custom_code_components(None, "ot-1") is None  # type: ignore[arg-type]
    assert _scrub_custom_code_components([], "ot-1") == []      # type: ignore[arg-type]
