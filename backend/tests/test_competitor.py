import json
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path
from uuid import UUID
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend.agents.competitor import AgentOutputError, CompetitorAgent
from backend.api.competitor import get_repository
from backend.config import Settings
from backend.main import app
from backend.schemas.agent import AgentRequest
from backend.schemas.evidence import EvidenceRecord
from backend.storage import RunStore
from backend.tools.retrieval import EvidenceRepository

SCOPE = {'vehicle': 'G60', 'market': 'Europe', 'powertrain': 'Electric', 'horizon': 4, 'topic': 'Displays'}

def record(eid='source-1', **overrides):
    return EvidenceRecord.model_validate(dict(id=eid, source_type='competitor_official', source_title='Test source', source_uri='https://example.org/spec', locator='Display', passage='A display is documented.', retrieved_at='2026-10-10T00:00:00Z', brand='Test peer', model='Test model', market='Europe', powertrain='Electric', reference_status='current_reference', verified_on=date.today(), review_due_on=date.today()+timedelta(days=30), **overrides))

def draft(eid='source-1'):
    return {'position': {'agent_id':'competitor','claims':[{'id':'claim-1','text':'A display is documented.','kind':'fact','evidence_ids':[eid]}],'stance':'revise','rationale':'Evaluate differentiation.'},'recommendations':[],'challenges':[],'assumptions':[],'uncertainties':[]}

class FakeLLM:
    def __init__(self, output=None, tool=None, review_issues=None):
        self.output=output or draft();self.tool=tool;self.calls=0;self.messages=[];self.review_issues=review_issues or []
    async def chat(self, messages, **kwargs):
        self.calls+=1;self.messages=list(messages)
        if kwargs.get('tools'):
            if self.tool and self.calls == 1:
                return {'message':{'content':'','tool_calls':[{'function':self.tool}]}}
            return {'message':{'content':'Research complete.'}}
        if kwargs['output_schema'].get('title')=='GroundingReview':
            return {'message':{'content':json.dumps({'issues':self.review_issues})}}
        self.output_schema=kwargs['output_schema']
        return {'message':{'content':json.dumps(self.output)}}

class AgentTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.settings=Settings.from_env();self.repository=EvidenceRepository([record()]);self.request=AgentRequest(analysis_id='test',scope=SCOPE)

    async def test_real_tool_dispatch_and_missing_baseline(self):
        llm=FakeLLM(tool={'name':'search_evidence','arguments':{'query':'display','source_type':'competitor_official'}})
        result=await CompetitorAgent(self.settings,self.repository,llm).run(self.request)
        self.assertIn('search_evidence: 1 records',result.research_steps)
        self.assertEqual(result.position.stance,'insufficient_evidence')
        self.assertEqual(result.evidence[0].id,'source-1')
        self.assertEqual(llm.output_schema['properties']['challenges']['maxItems'],0)
        with tempfile.TemporaryDirectory() as directory:
            store=RunStore(Path(directory));store.save(result)
            self.assertEqual(store.read(UUID(result.run_id)),result)

    async def test_hallucinated_citation_fails_after_one_repair(self):
        llm=FakeLLM(draft('invented-id'))
        with self.assertRaises(AgentOutputError):
            await CompetitorAgent(self.settings,self.repository,llm).run(self.request)
        self.assertEqual(llm.calls,3)

    async def test_unapproved_tool_is_never_executed(self):
        llm=FakeLLM(tool={'name':'execute_shell','arguments':{'command':'invalid'}})
        result=await CompetitorAgent(self.settings,self.repository,llm).run(self.request)
        self.assertIn('Rejected invalid tool request',result.research_steps)

    async def test_invented_fact_rejected_even_with_valid_citation(self):
        output=draft();output['position']['claims'][0]['text']='The competing vehicle lacks over-the-air updates.'
        with self.assertRaises(AgentOutputError):
            await CompetitorAgent(self.settings,self.repository,FakeLLM(output)).run(self.request)

    async def test_grounding_review_blocks_unsupported_interpretations(self):
        output=draft();output['position']['claims'][0]['kind']='inference'
        output['position']['claims'][0]['text']='All customers prefer this display.'
        with self.assertRaises(AgentOutputError):
            await CompetitorAgent(self.settings,self.repository,FakeLLM(output,review_issues=['No population data supports that conclusion.'])).run(self.request)

    async def test_marketwide_claim_cannot_hide_in_rationale(self):
        output=draft();output['position']['rationale']='These displays are becoming standard in the luxury segment.'
        with self.assertRaises(AgentOutputError):
            await CompetitorAgent(self.settings,self.repository,FakeLLM(output)).run(self.request)

    async def test_fabricated_debate_target_rejected(self):
        output=draft();output['challenges']=[{'target_agent_id':'customer','target_claim_id':'nonexistent','question':'Why?','evidence_ids':[]}]
        with self.assertRaises(AgentOutputError):
            await CompetitorAgent(self.settings,self.repository,FakeLLM(output)).run(self.request)

    async def test_valid_debate_target_and_version_preserved(self):
        req=AgentRequest(analysis_id='test',scope=SCOPE,stage='challenge',proposal={'proposal_id':'p1','version':2},prior_positions=[{'agent_id':'customer','claims':[{'id':'customer-1','text':'Users may prefer it.','kind':'hypothesis','evidence_ids':[]}],'stance':'support','rationale':'Test position.'}])
        output=draft();output['challenges']=[{'target_agent_id':'customer','target_claim_id':'customer-1','question':'What evidence supports that preference?','evidence_ids':['source-1']}]
        result=await CompetitorAgent(self.settings,self.repository,FakeLLM(output)).run(req)
        self.assertEqual(result.proposal.version,2)
        self.assertEqual(result.challenges[0].target_claim_id,'customer-1')

    async def test_out_of_scope_read_is_rejected(self):
        wrong=record().model_copy(update={'market':'China'})
        repo=EvidenceRepository([wrong])
        with self.assertRaises(ValueError):repo.read('source-1',self.request.scope)
        self.assertEqual(repo.search('display',self.request.scope),[])

    async def test_recommendation_requires_both_competitor_and_bmw_evidence(self):
        bmw=record('bmw-source').model_copy(update={'source_type':'bmw_equipment','brand':'BMW','model':'G60'})
        repo=EvidenceRepository([record(),bmw])
        output=draft()
        effect={'description':'Potential effect to test.','basis':'hypothesis','evidence_ids':[],'uncertainty':'Not measured.'}
        output['recommendations']=[{'title':'Test an option','proposed_change':'Evaluate a display option.','rationale':'Compare sourced experience.',
            'evidence_ids':['source-1'],'positive_effects':[effect],'negative_effects':[effect],
            'alternatives':['Improve existing controls.'],'validation_needed':['Check current fitment.']}]
        with self.assertRaises(AgentOutputError):
            await CompetitorAgent(self.settings,repo,FakeLLM(output)).run(self.request)
        output['recommendations'][0]['evidence_ids'].append('bmw-source')
        result=await CompetitorAgent(self.settings,repo,FakeLLM(output)).run(self.request)
        self.assertEqual(result.position.stance,'insufficient_evidence')
        self.assertTrue(any('trim' in step for step in result.recommendations[0].validation_needed))
        self.assertIn('confirmed existing BMW',result.recommendations[0].alternatives[0])
        self.assertIn('no direct measurement',result.recommendations[0].positive_effects[0].uncertainty)

class ApiTests(unittest.TestCase):
    def setUp(self):
        app.dependency_overrides[get_repository]=lambda:EvidenceRepository([record()])
        self.client=TestClient(app)
    def tearDown(self):
        app.dependency_overrides.clear();self.client.close()
    def test_analysis_does_not_accept_debate_turn(self):
        response=self.client.post('/api/competitor/analyze',json={'analysis_id':'x','scope':SCOPE,'stage':'challenge','proposal':{'proposal_id':'x','version':1}})
        self.assertEqual(response.status_code,422)
    def test_explicit_pm_trigger_required(self):
        data={'source_run_id':'00000000-0000-0000-0000-000000000001','analysis_id':'x','scope':SCOPE,'proposal':{'proposal_id':'x','version':1},'question':'Debate?'}
        self.assertEqual(self.client.post('/api/council/debate',json=data).status_code,422)
        self.assertEqual(self.client.post('/api/council/debate',json={**data,'trigger':'pm_requested'}).status_code,404)
    def test_unavailable_ollama_returns_service_error(self):
        import httpx
        with patch('backend.agents.competitor.OllamaClient.chat',side_effect=httpx.ConnectError('offline')):
            response=self.client.post('/api/competitor/analyze',json={'analysis_id':'x','scope':SCOPE})
        self.assertEqual(response.status_code,503)
    def test_path_traversal_run_id_rejected(self):
        self.assertEqual(self.client.get('/api/competitor/runs/not-a-uuid').status_code,422)

    def test_successful_api_result_is_saved_and_readable(self):
        import os
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'AGENT_RUNS_DIR':directory}):
            with patch('backend.agents.competitor.OllamaClient.chat',new=FakeLLM().chat):
                response=self.client.post('/api/competitor/analyze',json={'analysis_id':'api-check','scope':SCOPE})
            self.assertEqual(response.status_code,200,response.text)
            result=response.json()
            loaded=self.client.get('/api/competitor/runs/'+result['run_id'])
            self.assertEqual(loaded.json(),result)

class EvidenceQualityTests(unittest.TestCase):
    def setUp(self):
        self.scope=AgentRequest(analysis_id='quality',scope=SCOPE).scope

    def test_current_search_excludes_historical_expired_and_future_reviews(self):
        historical=record('history').model_copy(update={'reference_status':'historical_reference'})
        expired=record('expired').model_copy(update={'verified_on':date.today()-timedelta(days=60),'review_due_on':date.today()-timedelta(days=1)})
        future=record('future').model_copy(update={'verified_on':date.today()+timedelta(days=1)})
        repo=EvidenceRepository([historical,expired,future,record()])
        self.assertEqual([r.id for r in repo.search('display',self.scope,'competitor_official')],['source-1'])
        self.assertEqual(repo.read('history',self.scope).reference_status,'historical_reference')

    def test_brand_diversity_retains_other_competitors(self):
        rows=[record('a-'+str(i)) for i in range(4)]
        rows += [record('b').model_copy(update={'brand':'Second'}),record('c').model_copy(update={'brand':'Third'})]
        selected=EvidenceRepository(rows).search('display',self.scope,'competitor_official',3)
        self.assertEqual(len({r.brand for r in selected}),3)

    def test_market_and_powertrain_do_not_leak_across_scope(self):
        rows=[record('us').model_copy(update={'market':'United States'}), record('ice').model_copy(update={'powertrain':'Combustion'}),record()]
        self.assertEqual([r.id for r in EvidenceRepository(rows).search('display',self.scope)],['source-1'])

if __name__ == '__main__':unittest.main()
