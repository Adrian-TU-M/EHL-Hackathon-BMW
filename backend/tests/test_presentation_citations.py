"""The actual Ollama output schema must enforce the decision's source boundary."""
import pytest
from pydantic import ValidationError
from backend.presentation.service import dossier_schema


def test_dossier_schema_bounds_generation_and_validation():
    schema = dossier_schema(['source-a', 'source-b', 'source-a'])
    assert schema.model_json_schema()['properties']['evidence_ids']['items']['enum'] == ['source-a', 'source-b']
    assert schema(summary='Evidence summary', objection='Unknown impact', evidence_ids=['source-b']).evidence_ids == ['source-b']
    with pytest.raises(ValidationError):
        schema(summary='Evidence summary', objection='Unknown impact', evidence_ids=['invented-source'])


def test_dossier_without_sources_cannot_invent_a_citation():
    schema = dossier_schema([])
    assert schema(summary='No cited evidence', objection='Evidence missing').evidence_ids == []
    with pytest.raises(ValidationError):
        schema(summary='No cited evidence', objection='Evidence missing', evidence_ids=['source-a'])


def test_dossier_context_keeps_debate_and_removes_only_duplicate_payloads():
    from backend.presentation.models import ApprovedDecision
    from backend.presentation.service import dossier_decision
    decision = ApprovedDecision(id='req', version=1, title='Controls', description='Evaluate a prototype', pm_rationale='Test', debate=[
        {'kind':'complete_packet', 'source_inventory':['duplicate catalog'], 'evidence_index':['duplicate index'], 'claims':[{'id':'claim','statement':'A concern'}], 'challenges':[{'question':'Why?'}], 'transcript':[{'actor':'customer','statement':'Keep physical controls','data':{'claims':['duplicate']}}]},
        {'kind':'judge_assessment','native_request':{'arguments':['duplicate']},'native_assessment':{'summary':'Pilot first'}},
    ])
    original=decision.model_dump()
    compact=dossier_decision(decision)
    assert compact['debate'][0]['claims']==original['debate'][0]['claims']
    assert compact['debate'][0]['challenges']==original['debate'][0]['challenges']
    assert compact['debate'][0]['transcript']==[{'actor':'customer','statement':'Keep physical controls'}]
    assert compact['debate'][1]['native_assessment']=={'summary':'Pilot first'}
    assert 'source_inventory' not in compact['debate'][0]
    assert decision.model_dump()==original


def test_complete_sentence_at_layout_limit_is_not_treated_as_chopped():
    from backend.presentation.design import validate_written_copy, COPY_BUDGETS
    from backend.presentation.models import SlideSpec, SlideContent, SlideContentItem
    text='Test the controls with drivers and record the finding before wider rollout.'
    assert len(text) == COPY_BUDGETS['risks']['detail']
    slide=SlideSpec(id='risk',role='risks',title='Validate controls',content=SlideContent(kind='risks',items=[SlideContentItem(detail=text)]))
    validate_written_copy(slide)


def test_slide_repair_reports_all_clipped_fields_in_one_attempt():
    from backend.presentation.design import validate_written_copy
    from backend.presentation.models import SlideSpec, SlideContent, SlideContentItem
    slide=SlideSpec(id='problem',role='problem',title='Customer needs',content=SlideContent(kind='problem',items=[SlideContentItem(label='Controls...',detail='Improve usability...'),SlideContentItem(label='Charging...',detail='Show availability.')]))
    with pytest.raises(ValueError) as error:
        validate_written_copy(slide)
    assert all(field in str(error.value) for field in ['Item 1 label','Item 1 detail','Item 2 label'])
