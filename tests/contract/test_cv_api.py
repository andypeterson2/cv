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
    http_post,
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

    def test_error_envelope_on_validation_failure(self):
        """A rejected body is an error like any other, not its own shape."""
        status, body = http_post(BASE, "/api/profiles", {"name": ""})
        assert status == 400, f"expected 400 for an empty name, got {status}"
        assert_matches("error", body)
        assert body["error"]["code"] == "bad_request"
        assert body["error"]["details"], "a validation failure should say what failed"


class TestRateLimitEnvelope:
    """Kept last: it spends the upload limiter's window for this process."""

    def test_error_envelope_on_rate_limit(self):
        # The limiter answers before the handler, so an empty check is enough to reach it.
        limit = 5  # CV_UPLOAD_RATE_MAX default
        statuses = [http_post(BASE, "/api/layouts/check", {})[0] for _ in range(limit + 2)]
        assert 429 in statuses, f"expected the upload limiter to fire, saw {statuses}"
        body = next(b for st, b in (http_post(BASE, "/api/layouts/check", {}),) if st == 429)
        assert_matches("error", body)
        assert body["error"]["code"] == "rate_limited"


class TestReadShapes:
    """Normalized read endpoints: profiles → sections → entries → items + variants."""

    def test_catalog_section_types(self):
        status, body = http_get(BASE, "/api/catalog")
        assert status == 200
        assert isinstance(body.get("validSectionTypes"), list)
        assert "experience" in body["validSectionTypes"]

    def test_profiles_list_shape(self):
        status, body = http_get(BASE, "/api/profiles")
        assert status == 200
        assert isinstance(body.get("profiles"), list)

    def test_profile_main_shape(self):
        profiles = http_get(BASE, "/api/profiles")[1].get("profiles", [])
        if not profiles:
            pytest.skip("no profiles available to read a main")
        pid = profiles[0]["id"]
        status, body = http_get(BASE, f"/api/profiles/{pid}")
        assert status == 200
        for key in ("profile", "personal", "sections", "variants"):
            assert key in body, f"main is missing '{key}'"
        assert isinstance(body["sections"], list)
        assert isinstance(body["variants"], list)
