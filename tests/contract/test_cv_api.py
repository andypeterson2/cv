"""Live-HTTP API contract tests for the CV editor (Express).

Point ``CV_EDITOR_URL`` at a running editor; auto-skips if unreachable (the CI
``cv-contract`` job boots one on a temp DB). Validates the contract surface
(``/health``, ``/api`` discovery, error envelope) against the JSON Schemas, plus
the stable read shapes API clients (the editor UI, the MCP server) rely on.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import pytest
from _contract import (
    assert_matches,
    base_url,
    http_get,
    skip_unless_reachable,
)

BASE = base_url("CV_EDITOR_URL", "http://127.0.0.1:3001")
pytestmark = skip_unless_reachable(BASE, "CV_EDITOR_URL")


class TestContractSurface:
    def test_health(self):
        status, body = http_get(BASE, "/health")
        assert status == 200, f"/health returned {status}"
        assert_matches("health", body)
        assert body["service"] == "cv"

    def test_health_api_alias(self):
        status, body = http_get(BASE, "/api/health")
        assert status == 200
        assert_matches("health", body)

    def test_discovery(self):
        status, body = http_get(BASE, "/api")
        assert status == 200
        assert_matches("manifest", body)
        assert body["service"] == "cv"
        assert body["endpoints"], "discovery must list endpoints"

    def test_error_envelope(self):
        status, body = http_get(BASE, "/__contract_missing__")
        assert status == 404
        assert_matches("error", body)
        assert body["error"]["code"] == "not_found"


class TestReadShapes:
    """Normalized read endpoints: persons → sections → entries → items + variants."""

    def test_catalog_section_types(self):
        status, body = http_get(BASE, "/api/catalog")
        assert status == 200
        assert isinstance(body.get("validSectionTypes"), list)
        assert "experience" in body["validSectionTypes"]

    def test_persons_list_shape(self):
        status, body = http_get(BASE, "/api/persons")
        assert status == 200
        assert isinstance(body.get("persons"), list)

    def test_person_main_shape(self):
        persons = http_get(BASE, "/api/persons")[1].get("persons", [])
        if not persons:
            pytest.skip("no persons available to read a main")
        pid = persons[0]["id"]
        status, body = http_get(BASE, f"/api/persons/{pid}")
        assert status == 200
        for key in ("person", "personal", "sections", "variants"):
            assert key in body, f"main is missing '{key}'"
        assert isinstance(body["sections"], list)
        assert isinstance(body["variants"], list)
