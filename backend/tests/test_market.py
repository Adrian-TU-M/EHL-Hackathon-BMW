import json
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch
from backend.agents.market import MarketAgent, MarketParticipant, MarketRequest, validate_text
from backend.config import Settings
from backend.market.catalog import change, eligible, records_for
from backend.schemas.evidence import EvidenceRecord
from backend.schemas.common import Scope
from backend.schemas.agent import AgentPosition, Claim
from backend.schemas.council import CouncilTurn
from backend.agents.competitor import AgentOutputError

SCOPE=Scope(vehicle='G60',market='Europe',powertrain='Electric',horizon=4,topic='Charging')
def source(eid='metric',market='Europe',kind='market_metric'):
    return EvidenceRecord(id=eid,source_type=kind,source_title='Test source',source_uri='local:test',locator='A1',passage='Regional registrations increased from 100 to 110 vehicles in 2025.',retrieved_at='2026-10-10T12:00:00Z',brand='BMW Group',model='Group',market=market,categories=['Charging'],caveats=['Group data does not measure feature success.'])
class NumbersAndScopeTests(unittest.TestCase):
    def test_growth_has_correct_denominator_and_zero_is_unavailable(self):
        self.assertEqual(change(100,110),10)
        self.assertEqual(change(100,90),-10)
        self.assertEqual(change(100,0),-100)
        self.assertIsNone(change(0,10));self.assertIsNone(change(None,10))
    def test_group_and_combined_model_scopes_are_explicit(self):
        self.assertTrue(eligible(source(),SCOPE))
        self.assertFalse(eligible(source(market='China'),SCOPE))
        combined=source(kind='planning_volume').model_copy(update={'model':'G60_G68'})
        self.assertTrue(eligible(combined,SCOPE))
        self.assertFalse(eligible(combined,SCOPE.model_copy(update={'vehicle':'F70'})))
    def test_stale_and_future_signals_are_excluded(self):
        today=date.today()
        r=source(kind='industry_signal').model_copy(update={'verified_on':today,'review_due_on':today+timedelta(days=30),'reference_status':'current_reference'})
        self.assertTrue(eligible(r,SCOPE,'Charging'))
        self.assertFalse(eligible(r.model_copy(update={'reference_status':'unreviewed'}),SCOPE))
        self.assertFalse(eligible(r.model_copy(update={'published_on':today+timedelta(days=1)}),SCOPE))
        self.assertFalse(eligible(r,SCOPE,'Digital experience'))
        self.assertFalse(eligible(r.model_copy(update={'review_due_on':today-timedelta(days=1)}),SCOPE))
        self.assertFalse(eligible(r.model_copy(update={'verified_on':today+timedelta(days=1)}),SCOPE))
    def test_invented_numbers_and_causal_guarantees_are_rejected(self):
        for text in ['This will increase sales','Expect 87% success','BMW lacks this feature']:
            with self.assertRaises(ValueError):validate_text(text,[source()])
        validate_text('Test whether a simpler experience could help.',[source()])
    def test_global_powertrain_growth_cannot_be_called_regional(self):
        r=source('bmw-group-electrification').model_copy(update={'market':'Global'})
        with self.assertRaisesRegex(ValueError,'GLOBAL only'):
            validate_text('The evidence shows BMW Group electrification growth in Europe.',[r])
        validate_text('Regional powertrain data is missing; validate the local need.',[r])

class QueueLLM:
    def __init__(self,responses):self.responses=iter(responses);self.calls=[]
    async def chat(self,messages,**kwargs):
        self.calls.append((messages,kwargs));value=next(self.responses)
        return value if 'message' in value else {'message':{'content':json.dumps(value)}}

class MarketAgentTests(unittest.IsolatedAsyncioTestCase):
    async def test_research_tools_and_exact_facts_not_generated_numbers(self):
        r=source()
        draft=dict(evidence_ids=['metric'],stance='revise',rationale='Investigate relevance before prioritising.',proposed_action='Test the charging workflow with drivers.',possible_benefit='Could reduce planning effort.',possible_risk='May add complexity.',validation='Compare task completion in a prototype study.',counterpoint='Group registrations do not establish feature demand.')
        llm=QueueLLM([{'message':{'content':'','tool_calls':[{'function':{'name':'read_market_source','arguments':{'evidence_id':'metric'}}}]}},{'message':{'content':'Research complete'}},draft,{'issues':[]}])
        with patch('backend.agents.market.records_for',return_value=[r]):
            result=await MarketAgent(Settings.from_env(),llm=llm).run(MarketRequest(analysis_id='test',scope=SCOPE,market_topic='Charging'))
        self.assertEqual(result.position.agent_id,'market')
        self.assertEqual(result.position.claims[0].text,r.passage)
        self.assertTrue(any('read_market_source' in s for s in result.research_steps))
        self.assertEqual(result.recommendations[0].positive_effects[0].basis,'hypothesis')
    async def test_unknown_citation_rejected_after_one_repair(self):
        draft=dict(evidence_ids=['invented'],stance='revise',rationale='Check.',proposed_action='Test.',possible_benefit='Could help.',possible_risk='Could fail.',validation='Run a study.',counterpoint='Not measured.')
        llm=QueueLLM([{'message':{'content':'Done'}},draft,draft])
        with patch('backend.agents.market.records_for',return_value=[source()]):
            with self.assertRaises(AgentOutputError):await MarketAgent(Settings.from_env(),llm=llm).run(MarketRequest(analysis_id='test',scope=SCOPE))
    async def test_market_challenge_targets_real_peer_claim(self):
        prior=CouncilTurn(agent_id='competitor',stage='perspectives',position=AgentPosition(agent_id='competitor',stance='support',rationale='Investigate this feature.',claims=[Claim(id='competitor-1',text='Investigate.',kind='hypothesis')]))
        draft=dict(evidence_ids=['metric'],stance='revise',rationale='Regional registrations do not prove this feature is needed.',target_claim_id='competitor-1',question='What evidence links this proposal to regional customer demand?',answered_claim_ids=[])
        turn=await MarketParticipant(Settings.from_env(),QueueLLM([draft,{'issues':[]}])).turn('challenge',{},[source()],[prior])
        self.assertEqual(turn.challenges[0].target_claim_id,'competitor-1')
        self.assertEqual(turn.position.claims[0].text,source().passage)
    async def test_market_revision_must_answer_actual_challenge(self):
        first=CouncilTurn(agent_id='market',stage='perspectives',position=AgentPosition(agent_id='market',stance='revise',rationale='Investigate.',claims=[Claim(id='market-1',text='Investigate.',kind='hypothesis')]))
        challenge=CouncilTurn(agent_id='customer',stage='challenge',position=AgentPosition(agent_id='customer',stance='revise',rationale='Need evidence.',claims=[]),challenges=[dict(target_agent_id='market',target_claim_id='market-1',question='What customer benefit is established?',evidence_ids=[])])
        bad=dict(evidence_ids=['metric'],stance='revise',rationale='No measured benefit; test usability.',target_claim_id='',question='',answered_claim_ids=[])
        with self.assertRaises(AgentOutputError):await MarketParticipant(Settings.from_env(),QueueLLM([bad,bad])).turn('revision',{},[source()],[first,challenge])
        good={**bad,'answered_claim_ids':['market-1']}
        llm=QueueLLM([good,{'issues':[]}])
        result=await MarketParticipant(Settings.from_env(),llm).turn('revision',{},[source()],[first,challenge])
        schema=llm.calls[0][1]['output_schema']['properties']
        self.assertEqual(schema['question']['enum'],[''])
        self.assertEqual(schema['target_claim_id']['enum'],[''])
        self.assertEqual(schema['answered_claim_ids']['items']['enum'],['market-1'])
        self.assertEqual(result.answered_claim_ids,['market-1'])

class MarketCouncilIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_market_lead_routes_peer_challenge_revision_and_preserves_source(self):
        from dataclasses import replace
        from backend.council.coordinator import start_debate
        from backend.schemas.agent import AgentResult
        from backend.schemas.council import DebateRequest
        from backend.storage import RunStore
        from backend.tools.retrieval import EvidenceRepository
        from uuid import uuid4, UUID
        r=source()
        with tempfile.TemporaryDirectory() as directory:
            settings=replace(Settings.from_env(),runs_dir=Path(directory))
            saved=AgentResult(run_id=str(uuid4()),analysis_id='market-integration',scope=SCOPE,market_topic='Charging',model=settings.ollama_model,evidence=[r],recommendations=[],position=AgentPosition(agent_id='market',stance='revise',rationale='Test the regional need.',claims=[Claim(id='original',text=r.passage,kind='fact',evidence_ids=[r.id])]))
            RunStore(settings.runs_dir).save(saved)
            req=DebateRequest(analysis_id=saved.analysis_id,scope=SCOPE,source_run_id=saved.run_id,proposal={'proposal_id':saved.run_id,'version':1},trigger='pm_requested',question='What evidence supports this?')
            calls=[]
            class Participant:
                def __init__(self,role):self.role=role
                async def turn(self,stage,context,sources,prior):
                    calls.append((self.role,stage,context['lead_agent'],[t.agent_id for t in prior]))
                    return CouncilTurn(agent_id=self.role,stage=stage,position=AgentPosition(agent_id=self.role,stance='insufficient_evidence',rationale='Validate before prioritising.',claims=[]))
            factories={role:(lambda settings,role=role:Participant(role)) for role in ['customer','competitor','market','judge']}
            with patch('backend.council.coordinator.records_for',return_value=[r]),patch('backend.council.coordinator.PARTICIPANTS',factories):
                result=await start_debate(req,EvidenceRepository([]),settings=settings)
            self.assertEqual([(r,s) for r,s,_,_ in calls],[('customer','perspectives'),('competitor','perspectives'),('customer','challenge'),('market','revision'),('judge','assessment')])
            self.assertTrue(all(lead=='market' for _,_,lead,_ in calls))
            self.assertEqual(calls[0][3],[])
            self.assertEqual(calls[1][3],[])
            self.assertIn('customer',calls[3][3])
            self.assertEqual(result.turns[0].position.claims[0].id,'market-perspectives-1')
            self.assertEqual(RunStore(settings.runs_dir).read(UUID(saved.run_id)).position.claims[0].id,'original')
            self.assertEqual(result.decision,'awaiting_pm_review')
            from fastapi import HTTPException
            for changed in ([],[r.model_copy(update={'passage':'Revised data'})]):
                with patch('backend.council.coordinator.records_for',return_value=changed):
                    with self.assertRaises(HTTPException) as exc:await start_debate(req,EvidenceRepository([]),settings=settings)
                    self.assertEqual(exc.exception.status_code,409)

    async def test_debate_requires_explicit_pm_trigger(self):
        from backend.schemas.council import DebateRequest
        from pydantic import ValidationError
        from uuid import uuid4
        run_id=str(uuid4())
        with self.assertRaises(ValidationError):
            DebateRequest(analysis_id='test',scope=SCOPE,source_run_id=run_id,proposal={'proposal_id':run_id,'version':1},trigger='automatic',question='Debate now?')
