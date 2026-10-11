"""Pure contract regressions; no model or provider responses are mocked."""
import copy
import pytest
from backend.judge.models import JudgeRequest
from backend.judge.providers import keyed_assessment_schema, unpack_keyed_assessment, quote_options


def request():
    return JudgeRequest.model_validate({
        "scope": {"vehicle": "G60", "market": "Europe", "powertrain": "Electric", "horizon": 4},
        "features": [{"id": "controls", "version": 1, "title": "Controls", "description": "Accessible controls", "topic": "Controls"}],
        "arguments": [{"id": role, "agent": role, "feature_ids": ["controls"], "statement": "An argument", "evidence_ids": []}
                      for role in ("customer", "market", "competitor")],
        "evidence": [],
    })


def test_local_grammar_requires_every_role_once_and_no_unattached_citation():
    schema = keyed_assessment_schema(request())
    args = schema["properties"]["arguments"]
    assert args["required"] == ["customer", "market", "competitor"]
    assert args["additionalProperties"] is False
    for item in args["properties"].values():
        assert "argument_id" not in item["properties"]
        assert item["properties"]["citations"]["maxItems"] == 0
        assert item["properties"]["support"] == {"type": "null"}


def test_decode_preserves_public_contract_order_and_rejects_missing_or_extra_reviews():
    output = {"arguments": {role: {"support": None} for role in ("competitor", "customer", "market")},
              "features": {"controls": {"feature_version": 1}}}
    decoded = unpack_keyed_assessment(copy.deepcopy(output), request())
    assert [a["argument_id"] for a in decoded["arguments"]] == ["customer", "market", "competitor"]
    assert decoded["features"][0]["feature_id"] == "controls"
    for change in ("missing", "extra", "identity"):
        invalid = copy.deepcopy(output)
        if change == "missing":
            del invalid["arguments"]["market"]
        elif change == "extra":
            invalid["arguments"]["unknown"] = {}
        else:
            invalid["arguments"]["market"]["argument_id"] = "customer"
        with pytest.raises(ValueError):
            unpack_keyed_assessment(invalid, request())


def test_quote_choices_are_always_exact_bounded_source_substrings():
    for passage in ("First source sentence. Another sentence.\nExact wording.", "x" * 700, "a long source phrase " * 100):
        quotes = quote_options(passage)
        assert quotes
        assert all(0 < len(quote) <= 240 and quote in passage for quote in quotes)


def test_citation_grammar_binds_quote_to_the_arguments_own_source():
    data = request().model_dump()
    data["evidence"] = [{"id": eid, "domain": "customer", "source": "Contract test input",
        "location": "row", "published_at": "2026", "passage": passage, "provenance": "synthetic"}
        for eid, passage in (("source-a", "Exact first observation."), ("source-b", "A different observation."))]
    data["arguments"][0]["evidence_ids"] = ["source-a"]
    schema = keyed_assessment_schema(JudgeRequest.model_validate(data))
    citation = schema["properties"]["arguments"]["properties"]["customer"]["properties"]["citations"]["items"]["anyOf"]
    assert len(citation) == 1
    assert citation[0]["properties"]["evidence_id"]["enum"] == ["source-a"]
    assert citation[0]["properties"]["quote"]["enum"] == ["Exact first observation."]
