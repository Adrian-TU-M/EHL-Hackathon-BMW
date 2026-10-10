"""Cross-branch local-model, frozen-source and Judge mapping contracts."""
import json
from datetime import date, datetime, timezone, timedelta
from types import SimpleNamespace

import pytest

from backend.config import Settings
from backend.moderator import catalog_bridge
from backend.moderator.judge_bridge import judge_request
from backend.moderator.local import OllamaAdapters, constrain_schema, source_facts, hydrate_opening
from backend.moderator.models import AgendaRefinement, AgentPosition, Catalog, Scope
from backend.moderator.sources import applicable
from backend.schemas.evidence import EvidenceRecord


class FakeModel:
    async def chat(self, messages, **kwargs):
        self.messages, self.options = messages, kwargs
        return {"message": {"content": json.dumps({"groups": []})}, "prompt_eval_count": 127, "eval_count": 8}


@pytest.mark.asyncio
async def test_local_adapter_reports_real_usage_and_shared_model():
    llm = FakeModel()
    adapter = OllamaAdapters(Settings.from_env(), llm=llm)
    result = await adapter.call("moderator", "agenda", {"candidates": []}, AgendaRefinement.model_json_schema(), 100, "call1")
    assert adapter.mode == "ollama"
    assert result.tokens == 135
    assert result.data == {"groups": []}
    assert llm.options["max_tokens"] == 100
    assert "untrusted evidence" in llm.messages[0]["content"]


def test_local_schema_restricts_sources_actor_and_bounds_output():
    schema = constrain_schema(AgentPosition.model_json_schema(), "customer", "perspective", {"evidence": [{"id": "feedback1", "domain": "customer", "kind": "feedback", "passage": "The controls feel difficult to use while driving."}]})
    assert schema["properties"]["actor"]["const"] == "customer"
    assert schema["properties"]["claims"]["maxItems"] == 2
    option = schema["$defs"]["Claim"]["anyOf"][0]
    claim = option["properties"]
    assert claim["evidence_ids"]["const"] == ["feedback1"]
    assert "evidence_ids" in option["required"]
    assert claim["statement"]["const"] == "One supplied feedback observation: The controls feel difficult to use while driving."
    assert schema["properties"]["assumptions"]["maxItems"] == 0


def official(id, **changes):
    data = dict(id=id, source_type="industry_signal", source_title="Manufacturer announcement",
        source_uri="https://example.com/announcement", locator="Feature paragraph", passage="Voice control is announced for a future vehicle.",
        retrieved_at=datetime.now(timezone.utc), published_on=date.today(), brand="BMW", model="iX3", market="Global",
        categories=["Digital experience"], reference_status="current_reference", verified_on=date.today(),
        review_due_on=date.today() + timedelta(days=10))
    data.update(changes)
    return EvidenceRecord(**data)


def test_specialist_snapshot_preserves_scope_and_excludes_expired_or_changed(monkeypatch):
    current = official("current")
    expired = official("expired", verified_on=date.today() - timedelta(days=9), review_due_on=date.today() - timedelta(days=1))
    changed = official("changed")
    monkeypatch.setattr(catalog_bridge, "load_market", lambda: {"records": [r.model_dump(mode="json") for r in (current, expired, changed)]})
    monkeypatch.setattr(catalog_bridge, "source_checks", lambda: {"changed": {"status": "needs_review"}})
    monkeypatch.setattr(catalog_bridge.EvidenceRepository, "load", lambda _: SimpleNamespace(records={}))
    base = Catalog(snapshot_hash="initial", sources=[], evidence=[], warnings=[])
    result = catalog_bridge.specialist_catalog(base)
    assert [e.id for e in result.evidence] == ["specialist:current"]
    record = result.evidence[0]
    assert record.region is None and record.vehicle is None
    assert applicable(record, Scope(vehicle="G60", market="Europe", powertrain="Electric"), True)
    assert result.sources[0].coverage["model"] == "iX3"
    assert result.sources[0].source_url == current.source_uri
    assert base.evidence == []
    assert catalog_bridge.specialist_catalog(base).snapshot_hash == result.snapshot_hash


def test_native_judge_receives_actual_challenge_and_frozen_passage():
    data = {"packet": {
        "version": 1,
        "brief": {"topic_id": "topic-controls", "question": "How should controls improve?", "objective": "Usability",
            "scope": {"vehicle": "G60", "market": "Europe", "powertrain": "Electric", "horizon": 4, "prompt": "", "confirmedAt": None}},
        "claims": [{"id": "customer1", "actor": "customer", "statement": "The source reports confusing menus.", "evidence_ids": ["source1"], "assumption_ids": []}],
        "challenges": [{"target_claim_id": "customer1", "question": "Does this imply prevalence?", "response": "No, it is one observation."}],
        "alternatives": [], "assumptions": [], "coverage_limitations": [], "unresolved_issues": [], "pm_challenges": []},
        "evidence": [{"id": "source1", "source_id": "file1", "domain": "customer", "location": "row 4", "passage": "The menus are confusing.", "observation_id": "G60-0001"}],
        "source_inventory": [{"id": "file1", "name": "Feedback.xlsx", "provenance": "supplied"}]}
    request = judge_request(data)
    assert request.arguments[0].challenges == ["Does this imply prevalence? Response: No, it is one observation."]
    assert request.evidence[0].passage == "The menus are confusing."
    assert request.evidence[0].observation_id == "G60-0001"
    assert request.features[0].id == "topic-controls"
    assert request.external_processing_approved is False


@pytest.mark.asyncio
async def test_moderator_voice_rejects_stale_assessment_before_synthesis(monkeypatch):
    import httpx
    from backend.moderator.app import create_app
    from backend.judge.models import Weights
    import backend.voice as voice

    async def forbidden(*args, **kwargs):
        raise AssertionError('A stale assessment must never be sent to ElevenLabs')
    monkeypatch.setattr(voice, 'synthesize', forbidden)
    native = dict(id='saved-assessment', created_at='2026-10-11T00:00:00Z', arguments=[], features=[],
                  weights=Weights().model_dump(), constraints=[], ranked_feature_ids=[], next_action='continue',
                  execution='live', input_digest='frozen-input')
    outcome = SimpleNamespace(topic_id='topic-controls', assessment_valid=True,
                              assessment=SimpleNamespace(native_assessment=native))
    engine = SimpleNamespace(get=lambda _: SimpleNamespace(outcomes=[outcome]))
    app = create_app(engine)
    app.state.engine = engine
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        response = await client.post('/api/moderator/sessions/session1/outcomes/topic-controls/voice',
                                     json={'assessment_id': 'different-assessment'})
    assert response.status_code == 409
    assert 'changed' in response.json()['detail']


@pytest.mark.parametrize('source_kind,context_type,claim_kind',[
    ('provided_forecast','unknown','forecast'),
    ('report_context','management_expectation','forecast'),
    ('report_context','corporate_target','target'),
    ('external_context','model_announcement','inference'),
])
def test_local_source_claim_preserves_future_and_announcement_kind(source_kind,context_type,claim_kind):
    record={'id':'dated-source','domain':'market','kind':source_kind,'context_type':context_type,
            'passage':'The company states a future goal that remains conditional.'}
    schema=constrain_schema(AgentPosition.model_json_schema(),'market','perspective',{'evidence':[record]})
    assert schema['$defs']['Claim']['anyOf'][0]['properties']['kind']['const']==claim_kind


@pytest.mark.asyncio
async def test_missing_opening_citations_rejected_even_if_provider_ignores_schema():
    class MissingCitationModel:
        async def chat(self, messages, **kwargs):
            return {'message': {'content': json.dumps({'actor':'customer','summary':'Investigate usability.',
                'claims':[{'id':'c1','actor':'customer','kind':'observation','statement':'The controls are confusing.'}]})},
                'prompt_eval_count':100,'eval_count':60}
    adapter=OllamaAdapters(llm=MissingCitationModel())
    data={'evidence':[{'id':'source1','domain':'customer','kind':'feedback','passage':'The controls are confusing while driving.'}]}
    with pytest.raises(ValueError,match='selected_evidence_ids'):
        await adapter.call('customer','perspective',data,AgentPosition.model_json_schema(),500,'test')


def test_opening_uses_relevant_later_sentence_and_hydrates_citations():
    data = {'brief': {'topic_id': 'topic-controls'}, 'evidence': [
        {'id': 'feedback-actual', 'domain': 'customer', 'kind': 'feedback',
         'passage': 'I really enjoy driving this car. The physical buttons are difficult to find while driving. Charging is fast.'}]}
    facts = source_facts('customer', data)
    assert facts['feedback-actual']['statement'].endswith('The physical buttons are difficult to find while driving.')
    draft = dict(summary='Test button usability with a prototype.', selected_evidence_ids=['feedback-actual'],
                 alternative_title='Controls test', alternative_experiment='Compare two prototypes.',
                 possible_tradeoff='A possible added cost.', uncertainties=['Prevalence unknown.'], change_conditions=[])
    output = hydrate_opening(draft, 'customer', facts)
    assert output['claims'][0]['evidence_ids'] == ['feedback-actual']
    assert output['claims'][0]['id'] == 'source-1'
    assert output['alternatives'][0]['assumption_ids'] == []
    with pytest.raises(ValueError, match='unique supplied source'):
        hydrate_opening({**draft, 'selected_evidence_ids':['feedback-actual', 'feedback-actual']}, 'customer', facts)


def test_opening_selects_feature_sources_instead_of_unrelated_sales_baseline():
    data = {'brief': {'topic_id': 'topic-controls'}, 'evidence': [
        {'id':'sales', 'domain':'market', 'kind':'provided_forecast', 'passage':'Projected combined G60/G68 sales are 127000 units in 2030.'},
        {'id':'ncap', 'domain':'market', 'kind':'external_context', 'passage':'The new programme assesses essential controls and their usability.'}]}
    assert set(source_facts('market', data)) == {'ncap'}


def test_alternative_cannot_reference_unknown_assumption():
    empty = constrain_schema(AgentPosition.model_json_schema(), 'competitor', 'perspective', {'evidence':[]})
    assert empty['$defs']['Alternative']['properties']['assumption_ids']['maxItems'] == 0
    provided = constrain_schema(AgentPosition.model_json_schema(), 'competitor', 'perspective',
                                {'evidence':[], 'assumptions':[{'id':'assumption-actual'}]})
    assert provided['$defs']['Alternative']['properties']['assumption_ids']['items']['enum'] == ['assumption-actual']


@pytest.mark.asyncio
async def test_semantic_review_must_classify_exact_canonical_ids():
    from backend.moderator.models import SemanticReview
    class WrongIdModel:
        async def chat(self, messages, **kwargs):
            return {'message':{'content':json.dumps({'supported_ids':['claim-1'],'unsupported':{}})},
                    'prompt_eval_count':100,'eval_count':20}
    adapter=OllamaAdapters(llm=WrongIdModel())
    with pytest.raises(ValueError,match='every exact supplied claim ID'):
        await adapter.call('moderator','semantic_check',{'claims':[{'id':'topic-controls:customer:claim-1'}]},
                           SemanticReview.model_json_schema(),500,'test')


def test_moderator_store_rejects_second_writer_and_releases_lock(tmp_path):
    from backend.moderator.storage import Store
    path=tmp_path/'moderator.sqlite3'
    store=Store(path)
    try:
        with pytest.raises(RuntimeError,match='already open'):
            Store(path)
    finally:
        store.close()
    reopened=Store(path)
    reopened.close()


@pytest.mark.asyncio
async def test_snapshot_behind_event_log_recovers_without_overwriting_history(engine,scope):
    from backend.moderator.engine import Engine
    from backend.moderator.adapters import DeterministicAdapters
    session=await engine.create(scope)
    previous=engine.store.events(session.id)
    session.sequence=0
    engine.store.save(session)
    recovered=Engine(engine.catalog,engine.store,DeterministicAdapters())
    assert recovered.get(session.id).status=='paused'
    assert recovered.get(session.id).sequence==previous[-1].sequence+1
    assert recovered.store.events(session.id)[0]==previous[0]
    assert recovered.store.events(session.id)[-1].stage=='recovery'


@pytest.mark.asyncio
async def test_judge_unavailable_preserves_safe_actionable_message(engine, scope):
    from moderator.adapters import DeterministicAdapters
    from backend.judge.adapters import Unavailable
    from .test_workflow import confirmed, control
    class UnavailableJudge(DeterministicAdapters):
        async def call(self, actor, operation, data, *args):
            if actor == 'judge':
                raise Unavailable('Model inference timed out. Try fewer features or increase JUDGE_MODEL_TIMEOUT_SECONDS for local Qwen.')
            return await super().call(actor, operation, data, *args)
    engine.adapters = UnavailableJudge()
    session = await confirmed(engine, scope)
    await control(engine, session)
    await engine.tasks[session.id]
    assert session.outcomes[0].assessment is None
    assert any('JUDGE_MODEL_TIMEOUT_SECONDS' in issue for issue in session.outcomes[0].packet.unresolved_issues)


@pytest.mark.asyncio
async def test_controller_source_quotes_pass_but_paraphrases_and_wrong_scope_do_not(engine, scope):
    from moderator.agenda import brief
    from moderator.models import AgentPosition, Work
    session = await engine.create(scope)
    session.work = Work(brief=brief(session.agenda, 'topic-controls', engine.catalog))
    engine.adapters.mode = 'ollama'
    fact = source_facts('customer', engine.payload(session, 'customer'))['f1']
    foreign = engine.index(session)['foreign'].model_dump()
    wrong = source_facts('customer', {'evidence':[foreign], 'brief':{}})['foreign']
    position = AgentPosition(actor='customer', summary='Test control usability.', claims=[
        fact, {**fact, 'id':'overclaim', 'statement':fact['statement'] + ' This proves a safety benefit for all BMW drivers.'},
        {**wrong, 'id':'wrong-scope'},
    ])
    engine.accept_position(session, 'customer', position)
    exact, overclaim, wrong_scope = session.work.claims
    assert exact.validation == 'supported' and exact.semantic_check == 'exact_source_quote'
    assert overclaim.validation == 'unverified' and overclaim.semantic_check == 'pending'
    assert wrong_scope.validation == 'unsupported'
