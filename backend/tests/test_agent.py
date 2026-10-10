import pytest

from customer_agent.agent import CustomerAgent, scrub_ids, soften_overclaims, split_recommendation, strip_numeric_claims
from customer_agent.schemas import PerspectiveRequest, Scope, StudyRef

from .conftest import FakeLLM

EU = Scope(vehicle="X10", market="Europe")


def finding(kind, theme, ev, detail="Customers describe this issue in their own words.", st=()):
    return {"kind": kind, "theme": theme, "title": "A finding", "detail": detail,
            "evidenceIds": list(ev), "studyRefIds": list(st), "uncertainty": "Small sample."}


def test_fabricated_and_mismatched_citations_are_removed(data_dir, load, maps):
    llm = FakeLLM({"findings": [
        # X10-0009 is a Like; it cannot support a complaint. X10-9999 does not exist.
        finding("recurring_complaint", "Infotainment & connectivity", ["X10-0001", "X10-0008", "X10-9999"]),
        finding("recurring_complaint", "Interior design & quality", ["X10-0009"]),
    ]}, {"checks": []})
    result = CustomerAgent(load(data_dir), maps, llm).analyze(EU)
    assert [f.evidenceIds for f in result.findings] == [["X10-0001", "X10-0008"]]
    assert result.droppedCitations == 2
    assert {e.id for e in result.evidence} == {"X10-0001", "X10-0008"}


def test_numbers_come_from_code_not_the_model(data_dir, load, maps):
    llm = FakeLLM({"findings": [finding(
        "recurring_complaint", "Infotainment & connectivity", ["X10-0001", "X10-0008"],
        detail="Customers find the screen confusing. 87% of owners hate it. This is shared across many records.")]},
        {"checks": []})
    f = CustomerAgent(load(data_dir), maps, llm).analyze(EU).findings[0]
    assert "87" not in f.detail and "shared across" not in f.detail
    assert f.detail == "Customers find the screen confusing."
    assert "removed" in f.uncertainty
    share = f.quantitative[0]
    assert (share.numerator, share.denominator) == (3, 6)   # computed by stats: 3 of 6 EU records
    assert f.records == 3 and f.customersIdentifiable is False


def test_verification_pass_drops_unsupported_quotes(data_dir, load, maps):
    llm = FakeLLM(
        {"findings": [finding("recurring_complaint", "Infotainment & connectivity", ["X10-0001", "X10-0008"])]},
        {"checks": [{"finding": 0, "id": "X10-0008", "supports": False}]},
    )
    f = CustomerAgent(load(data_dir), maps, llm).analyze(EU).findings[0]
    assert f.evidenceIds == ["X10-0001"]
    assert "single feedback record" in f.uncertainty


def test_finding_without_surviving_quotes_is_dropped(data_dir, load, maps):
    llm = FakeLLM(
        {"findings": [finding("recurring_complaint", "Infotainment & connectivity", ["X10-0001"])]},
        {"checks": [{"finding": 0, "id": "X10-0001", "supports": False}]},
    )
    assert CustomerAgent(load(data_dir), maps, llm).analyze(EU).findings == []


def test_prompt_contains_only_scoped_customer_evidence(data_dir, load, maps):
    llm = FakeLLM({"findings": []})
    CustomerAgent(load(data_dir), maps, llm).analyze(EU)
    prompt = llm.prompts[0]
    assert "X10-0001" in prompt
    assert "X10-0005" not in prompt          # US record is out of scope
    assert "volume_2024" not in prompt       # sales data never reaches the agent


def test_study_only_scope(data_dir, load, maps):
    llm = FakeLLM({"findings": [{
        "kind": "unmet_need", "theme": "Infotainment & connectivity", "title": "Ease of use lags",
        "detail": "Infotainment ease of use is rated below peers.", "evidenceIds": ["X10-0001"],
        "studyRefIds": ["STUDY:CN_EU_2025:8:G68", "STUDY:bogus"], "uncertainty": "Means only."}]})
    result = CustomerAgent(load(data_dir), maps, llm).analyze(Scope(vehicle="G68", market="China"))
    f = result.findings[0]
    assert f.studyRefIds == ["STUDY:CN_EU_2025:8:G68"] and f.evidenceIds == []
    assert "no feedback records" in f.uncertainty
    assert result.droppedCitations == 2


def test_perspective_without_evidence_is_deterministic(data_dir, load, maps):
    llm = FakeLLM()
    event = CustomerAgent(load(data_dir), maps, llm).perspective(
        PerspectiveRequest(scope=EU, topic="Trunk"))
    assert event.model == "deterministic" and not llm.prompts
    assert "no customer feedback" in event.statement


def test_perspective_validates_and_verifies(data_dir, load, maps):
    llm = FakeLLM(
        {"statement": "Drivers struggle with the screen (X10-0001, X10-0004).", "recommendation": "Simplify menus.",
         "evidenceIds": ["X10-0001", "X10-0004", "X10-7777"], "studyRefIds": [], "uncertainties": [],
         "assumption": ""},
        {"checks": [{"finding": 0, "id": "X10-0004", "supports": False}]},
    )
    event = CustomerAgent(load(data_dir), maps, llm).perspective(
        PerspectiveRequest(scope=EU, topic="Displays", stage="challenge", challenge="Is this real?"))
    assert event.evidenceIds == ["X10-0001"]
    assert [e.id for e in event.evidence] == ["X10-0001"] and event.evidence[0].passage
    assert event.stage == "challenge" and "Is this real?" in llm.prompts[0]
    assert event.evidenceBase.startswith("Evidence base: ") and "customers cannot be counted" in event.evidenceBase
    assert "Evidence base: " in llm.prompts[0]


def test_split_recommendation_removes_repeat():
    s = "Widgets vanish (G70-1). Initial recommendation: Stabilise the software."
    assert split_recommendation(s, "Stabilise the software.") == "Widgets vanish (G70-1)."
    assert split_recommendation("Widgets vanish. Stabilise the software.", "Stabilise the software") == "Widgets vanish."
    assert split_recommendation("Widgets vanish.", "Fix it.") == "Widgets vanish."


def test_strip_numeric_drops_dangling_connective():
    out, removed = strip_numeric_claims("There are 346 complaints. However, feedback is self-selected. G60 scores HIGHEST.")
    assert removed == 1 and out == "Feedback is self-selected. G60 scores highest."


def test_frequency_words_keep_how_many():
    out, _ = strip_numeric_claims("We cannot tell how many customers see this. Many drivers complain.")
    assert out == "We cannot tell how many customers see this. Some drivers complain."


def test_soften_overclaims():
    out = soften_overclaims("Infotainment is a recurring complaint theme; issues are concentrated in iDrive, a clear need.")
    assert out == "Infotainment is a complaint theme; issues are in iDrive, a possible need."


def test_study_direction_spells_out_rank():
    ref = lambda v: StudyRef.model_construct(id="S", source="s", market="Europe", vehicle="G70", attribute="a", metric="mean",
                             value=v, comparison={"F70": 8.16, "G60": 8.26})
    assert "LOWEST" in CustomerAgent._study_direction(ref(7.99))
    assert "HIGHEST" in CustomerAgent._study_direction(ref(8.5))
    assert "rank 2 of 3" in CustomerAgent._study_direction(ref(8.2))


@pytest.mark.parametrize("text,valid,expected", [
    ("Praised (G60-1, G60-2).", {"G60-1"}, "Praised (G60-1)."),
    ("Said X (G60-9) and Y (STUDY:A:1:G60).", set(), "Said X and Y."),
    ("[G60-1] liked it, while [G60-9] did not.", {"G60-1"}, "[G60-1] liked it, while did not."),
])
def test_scrub_ids(text, valid, expected):
    assert scrub_ids(text, valid) == expected


def test_strip_numeric_claims_keeps_model_codes():
    text, removed = strip_numeric_claims("The G60 screen is slow. 3 out of 4 drivers agree.")
    assert text == "The G60 screen is slow." and removed == 1


def test_frequency_words_keep_sentence_case():
    text, _ = strip_numeric_claims("Several customers praise it. It is often noted by many owners.")
    assert text == "Some customers praise it. It is noted by some owners."
