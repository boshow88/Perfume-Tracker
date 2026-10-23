"""Smoke test for mobile-import parsing / fuzzy helpers.

Standalone – does not spin up the tkinter GUI.  Exits 0 on success.
"""
import json
import sys

# Silence the Windows DPI code that runs on import (already imported =
# runs once).  We just need the parse helpers.
import perfume_tracker as pt


def _expect(cond, msg):
    if not cond:
        print(f"FAIL: {msg}")
        sys.exit(1)
    print(f"ok: {msg}")


def test_parse_ok():
    raw = json.dumps({
        "version": 1,
        "generated_at": "2026-07-14T00:00:00Z",
        "generator": "perfume-tracker-web/1.0",
        "drafts": [
            {
                "kind": "new_event",
                "temp_id": "t1",
                "created_at": "2026-07-14T00:00:00Z",
                "perfume_id": "abc123",
                "perfume_name_snapshot": "Sample One",
                "brand_name_snapshot": "Acme",
                "event": {
                    "event_type": "smell",
                    "event_date": "2026-07-14",
                    "outlet_name_new": "Airport Duty Free",
                    "note": "quick sniff",
                },
            },
            {
                "kind": "new_perfume",
                "temp_id": "t2",
                "created_at": "2026-07-14T00:00:00Z",
                "data": {
                    "name": "Mystery Elixir",
                    "brand_name_new": "Unknown House",
                    "concentration_name_new": "EDP",
                    "year": 2024,
                    "tag_names_new": ["woody", "sweet"],
                    "events": [
                        {"event_type": "smell", "event_date": "2026-07-13",
                         "outlet_name_new": "Boutique X"},
                    ],
                    "my_votes": {"rating": {"like": 1}},
                    "notes": [{"title": "Impression", "content": "warm and rich"}],
                },
            },
            {
                "kind": "edit_perfume",
                "temp_id": "t3",
                "created_at": "2026-07-14T00:00:00Z",
                "perfume_id": "abc123",
                "perfume_name_snapshot": "Sample One",
                "brand_name_snapshot": "Acme",
                "modified_fields": {"name": "Sample One (2025 reissue)"},
            },
            # Bad drafts to test partial parse
            {"kind": "unknown_kind", "temp_id": "t-bad"},
            "not-a-dict",
        ],
    })
    bundle, errors = pt.parse_mobile_bundle(raw)
    _expect(bundle is not None, "bundle parses")
    _expect(len(bundle["drafts"]) == 3, "keeps 3 good drafts, drops 2 bad")
    _expect(len(errors) == 2, "produces 2 error messages")


def test_parse_bad_version():
    raw = json.dumps({"version": 999, "drafts": []})
    bundle, errors = pt.parse_mobile_bundle(raw)
    _expect(bundle is None, "rejects wrong version")
    _expect(any("Unsupported bundle version" in e for e in errors),
            "version error message present")


def test_parse_bad_json():
    bundle, errors = pt.parse_mobile_bundle("{not valid json}")
    _expect(bundle is None, "rejects invalid JSON")
    _expect(any("Invalid JSON" in e for e in errors), "json error message present")


def test_fuzzy_match():
    cands = ["Chanel", "Christian Dior", "Creed", "Byredo"]
    matches = pt.fuzzy_match_names("Chnael", cands)
    _expect(len(matches) >= 1, "fuzzy finds at least one match for typo")
    _expect(matches[0][0] == "Chanel", "top match is Chanel")

    matches2 = pt.fuzzy_match_names("Byrdo", cands)
    _expect(matches2 and matches2[0][0] == "Byredo", "top match is Byredo for Byrdo")

    empty = pt.fuzzy_match_names("", cands)
    _expect(empty == [], "empty query returns []")

    no_cands = pt.fuzzy_match_names("Chanel", [])
    _expect(no_cands == [], "empty candidates returns []")


def test_roundtrip_js_shape():
    """Verify the exact JSON shape web/app.js emits parses cleanly and
    would apply successfully.  This mirrors buildExportBundle() +
    savePerfumeDraft() / saveEditPerfumeDraft() / saveEventDraft() to
    catch schema drift between the two sides."""
    # A bundle exercising every kind + every optional variant.
    bundle_raw = {
        "version": 1,
        "generated_at": "2026-07-21T00:00:00.000Z",
        "generator": "perfume-tracker-web/1.0",
        "drafts": [
            # new_event -- targets an existing perfume by id, with a new outlet name
            {
                "kind": "new_event",
                "temp_id": "draft-abc-001",
                "created_at": "2026-07-21T00:00:00.000Z",
                "perfume_id": "existing-perfume-uuid",
                "perfume_name_snapshot": "Existing Perfume",
                "brand_name_snapshot": "Existing Brand",
                "event": {
                    "event_type": "smell",
                    "event_date": "2026-07-21",
                    "outlet_name_new": "Airport Duty Free",
                    "note": "quick sniff",
                },
            },
            # new_event -- targets by id with existing outlet id
            {
                "kind": "new_event",
                "temp_id": "draft-abc-002",
                "created_at": "2026-07-21T00:00:00.000Z",
                "perfume_id": "existing-perfume-uuid",
                "perfume_name_snapshot": "Existing Perfume",
                "brand_name_snapshot": "Existing Brand",
                "event": {
                    "event_type": "skin",
                    "outlet_id": "existing-outlet-uuid",
                },
            },
            # new_perfume with a mix of new brand + existing tag + new tag
            {
                "kind": "new_perfume",
                "temp_id": "draft-abc-003",
                "created_at": "2026-07-21T00:00:00.000Z",
                "data": {
                    "name": "Mystery Elixir",
                    "brand_name_new": "New House",
                    "concentration_id": "existing-conc-uuid",
                    "concentration_name_snapshot": "EDP",
                    "year": 2024,
                    "tag_ids": ["existing-tag-uuid"],
                    "tag_names_snapshot": ["woody"],
                    "tag_names_new": ["sweet"],
                    "outlet_names_new": ["Boutique X"],
                    "events": [
                        {"event_type": "smell", "event_date": "2026-07-20"},
                    ],
                    "notes": [{"title": "First impression", "content": "warm"}],
                    # Personal votes live under my_* keys inside my_votes;
                    # keeping this in sync with COMPACT_VOTE_DIMS in the
                    # web app is important -- see the comment there.
                    "my_votes": {
                        "my_rating_votes": {"like": 1},
                        "my_longevity_votes": {"moderate": 1},
                    },
                },
            },
            # edit_perfume with name change + tag adjustment + vote change
            {
                "kind": "edit_perfume",
                "temp_id": "draft-abc-004",
                "created_at": "2026-07-21T00:00:00.000Z",
                "perfume_id": "existing-perfume-uuid",
                "perfume_name_snapshot": "Existing Perfume",
                "brand_name_snapshot": "Existing Brand",
                "modified_fields": {
                    "name": "Existing Perfume (2025)",
                    "tags": {
                        "tag_ids": ["existing-tag-uuid"],
                        "tag_names_new": ["floral"],
                    },
                    "my_votes": {
                        "my_rating_votes": {"love": 1},
                    },
                },
            },
        ],
    }
    bundle, errors = pt.parse_mobile_bundle(json.dumps(bundle_raw))
    _expect(bundle is not None, "js-shape bundle parses")
    _expect(len(bundle["drafts"]) == 4, "keeps all 4 well-formed drafts")
    _expect(errors == [], "no errors reported")

    # Cross-check the field keys the desktop's apply methods expect are
    # actually present in the JS shape.  This catches "renamed a field on
    # one side but not the other" style regressions.
    ne = bundle["drafts"][0]
    _expect(ne["event"].get("event_type") == "smell", "new_event.event.event_type present")
    np = bundle["drafts"][2]
    _expect("data" in np and "name" in np["data"], "new_perfume.data.name present")
    _expect("brand_name_new" in np["data"], "new_perfume brand_name_new carried")
    ep = bundle["drafts"][3]
    _expect("modified_fields" in ep, "edit_perfume.modified_fields present")
    _expect("tags" in ep["modified_fields"], "edit_perfume tags in modified_fields")


def main():
    test_parse_ok()
    test_parse_bad_version()
    test_parse_bad_json()
    test_fuzzy_match()
    test_roundtrip_js_shape()
    print("\nAll smoke tests passed.")


if __name__ == "__main__":
    main()
