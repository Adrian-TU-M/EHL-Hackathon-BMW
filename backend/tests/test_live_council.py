import asyncio
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import UUID, uuid4
from fastapi import HTTPException
from backend.config import Settings
from backend.jobs import submit, read, save, tasks
from backend.storage import RunStore
from backend.schemas.agent import AgentResult
from backend.schemas.council import DebateRequest, CouncilTurn
from backend.council.coordinator import start_debate, load_proposal
from backend.council.participants import GroundedParticipant
from backend.agents.competitor import AgentOutputError
from backend.tools.retrieval import EvidenceRepository
from test_competitor import SCOPE, record, draft, FakeLLM
from backend.agents.competitor import CompetitorAgent
from backend.schemas.agent import AgentRequest

class JobTests(unittest.IsolatedAsyncioTestCase):
    async def test_job_persists_and_rejects_concurrent_runs(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'AGENT_RUNS_DIR':directory}):
            event = asyncio.Event()
            async def work(progress):
                progress('Testing persistence');await event.wait()
                return AgentRequest(analysis_id='job',scope=SCOPE)
            job=await submit('analysis',{},work)
            task=tasks[job['id']]
            await asyncio.sleep(0)
            self.assertEqual(read(job['id'])['phase'],'Testing persistence')
            with self.assertRaises(HTTPException) as raised:await submit('analysis',{},work)
            self.assertEqual(raised.exception.status_code,409)
            event.set();await task
            self.assertEqual(read(job['id'])['status'],'succeeded')
            self.assertEqual(read(job['id'])['result']['analysis_id'],'job')
    async def test_request_id_is_idempotent_and_cannot_change_payload(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'AGENT_RUNS_DIR':directory}):
            event=asyncio.Event();count=0
            async def work(progress):
                nonlocal count
                count+=1;await event.wait();return AgentRequest(analysis_id='once',scope=SCOPE)
            job_id=uuid4()
            job=await submit('analysis',{'scope':'first'},work,job_id)
            task=tasks[job['id']]
            duplicate=await submit('analysis',{'scope':'first'},work,job_id)
            self.assertEqual(job['id'],duplicate['id'])
            with self.assertRaises(HTTPException):await submit('analysis',{'scope':'different'},work,job_id)
            event.set();await task;self.assertEqual(count,1)

    async def test_failures_and_interrupted_runs_are_not_success(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'AGENT_RUNS_DIR':directory}):
            async def work(progress): raise ValueError('Invalid evidence')
            job=await submit('analysis',{},work); await tasks[job['id']]
            self.assertEqual(read(job['id'])['status'],'failed')
            self.assertIn('Invalid evidence',read(job['id'])['error'])
            job.update(id=str(uuid4()),status='running');save(job)
            self.assertEqual(read(job['id'])['phase'],'Interrupted')

class CouncilTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.market_patch=patch('backend.council.coordinator.records_for',return_value=[])
        self.market_patch.start()
        self.addCleanup(self.market_patch.stop)
        self.tmp=tempfile.TemporaryDirectory()
        self.env=patch.dict(os.environ,{'AGENT_RUNS_DIR':self.tmp.name});self.env.start()
        self.settings=Settings.from_env();self.repo=EvidenceRepository([record()])
        self.source=await CompetitorAgent(self.settings,self.repo,FakeLLM()).run(AgentRequest(analysis_id='live',scope=SCOPE))
        RunStore(self.settings.runs_dir).save(self.source)
        self.request=DebateRequest(analysis_id='live',source_run_id=self.source.run_id,proposal={'proposal_id':self.source.run_id,'version':1},scope=SCOPE,trigger='pm_requested',question='Should BMW investigate?')
    async def asyncTearDown(self):self.env.stop();self.tmp.cleanup()
    async def test_stale_proposal_scope_and_model_are_rejected(self):
        for field,value in [('proposal',self.request.proposal.model_copy(update={'version':2})),('analysis_id','different')]:
            with self.assertRaises(HTTPException):load_proposal(self.request.model_copy(update={field:value}),self.settings)
        changed=self.source.model_copy(update={'model':'different:model'});RunStore(self.settings.runs_dir).save(changed)
        with self.assertRaises(HTTPException):load_proposal(self.request,self.settings)
    async def test_changed_evidence_rejected_before_any_model_call(self):
        changed=record().model_copy(update={'passage':'Different source material now.'})
        with self.assertRaises(HTTPException):await start_debate(self.request,EvidenceRepository([changed]),settings=self.settings)
    async def test_council_shares_real_claims_and_reuses_saved_position(self):
        calls=[]
        class Participant:
            def __init__(inner,role):inner.role=role
            async def turn(inner,stage,context,sources,prior):
                calls.append((inner.role,stage,[t.agent_id for t in prior]))
                body=draft()['position'];body.update(agent_id=inner.role)
                body['claims'][0].update(id=f'{inner.role}-{stage}-1',kind='hypothesis')
                return CouncilTurn(agent_id=inner.role,stage=stage,position=body,answered_claim_ids=[prior[0].position.claims[0].id] if prior else [])
        factories={role:(lambda settings,role=role:Participant(role)) for role in ['customer','market','competitor','judge']}
        with patch('backend.council.coordinator.PARTICIPANTS',factories):
            result=await start_debate(self.request,self.repo,settings=self.settings)
        self.assertEqual(result.turns[0].position.claims[0].text,self.source.position.claims[0].text)
        self.assertEqual(calls[0][2],[]);self.assertEqual(calls[1][2],[])
        self.assertIn('customer',calls[3][2]);self.assertEqual(result.source_run_id,self.source.run_id)
        self.assertEqual(result.decision,'awaiting_pm_review');self.assertEqual(len(result.turns),6)
        self.assertEqual(RunStore(self.settings.runs_dir).read(UUID(self.source.run_id)),self.source)
    async def test_selected_brand_cannot_retrieve_other_brand(self):
        other=record('other').model_copy(update={'brand':'Another'})
        req=AgentRequest(analysis_id='select',scope=SCOPE,competitor_brand='Test peer',competitor_model='Test model',evidence_ids=['source-1'])
        result=await CompetitorAgent(self.settings,EvidenceRepository([record(),other,record('unselected-feature')]),FakeLLM()).run(req)
        self.assertEqual([r.id for r in result.evidence],['source-1'])
        self.assertEqual(result.requested_evidence_ids,['source-1'])
    async def test_unknown_debate_target_is_rejected(self):
        position=draft()['position'];position['agent_id']='customer';position['claims'][0].update(kind='inference',text='BMW trim availability remains unverified in this evidence set.',evidence_ids=[])
        body=dict(agent_id='customer',stage='challenge',position=position,challenges=[dict(target_agent_id='competitor',target_claim_id='invented',question='Why?',evidence_ids=[])],answered_claim_ids=[])
        class LLM:
            async def chat(inner,*args,**kwargs):return {'message':{'content':json.dumps(body)}}
        prior=CouncilTurn(agent_id='competitor',stage='perspectives',position=self.source.position)
        with self.assertRaisesRegex(AgentOutputError, 'actual other-agent claim'):await GroundedParticipant('customer',self.settings,LLM()).turn('challenge',{},[record()],[prior])


class RevisionContractTests(unittest.IsolatedAsyncioTestCase):
    async def test_missing_feature_attributed_to_feedback_is_rejected(self):
        position=draft()['position'];position.update(agent_id='market',rationale='Customer feedback highlights the lack of a front passenger display, but this is unverified.')
        position['claims'][0].update(kind='inference',text='BMW trim availability remains unverified in this evidence set.',evidence_ids=[])
        body=dict(agent_id='market',stage='perspectives',position=position,challenges=[],answered_claim_ids=[])
        class LLM:
            async def chat(inner,*args,**kwargs):return {'message':{'content':json.dumps(body)}}
        with self.assertRaisesRegex(AgentOutputError,'Do not assert or attribute'):
            await GroundedParticipant('market',Settings.from_env(),LLM()).turn('perspectives',{},[record()],[])

    async def test_revision_cannot_open_new_challenges_or_ignore_actual_challenge(self):
        initial=CouncilTurn(agent_id='competitor',stage='perspectives',position=draft()['position'])
        cp=draft()['position'];cp.update(agent_id='customer');cp['claims'][0].update(id='customer-question',kind='hypothesis')
        challenge=CouncilTurn(agent_id='customer',stage='challenge',position=cp,challenges=[dict(target_agent_id='competitor',target_claim_id='claim-1',question='What supports this?',evidence_ids=[])])
        for new_challenge in (True,False):
            position=draft()['position'];position['claims'][0].update(kind='inference',text='BMW trim availability remains unverified in this evidence set.',evidence_ids=[])
            body=dict(agent_id='competitor',stage='revision',position=position,
                challenges=[dict(target_agent_id='customer',target_claim_id='customer-question',question='Why?',evidence_ids=[])] if new_challenge else [],
                answered_claim_ids=['claim-1'] if new_challenge else ['customer-question'])
            class LLM:
                async def chat(inner,*args,**kwargs): return {'message':{'content':json.dumps(body)}}
            message='Only the challenge stage' if new_challenge else 'actual claim challenged'
            with self.assertRaisesRegex(AgentOutputError,message):
                await GroundedParticipant('competitor',Settings.from_env(),LLM()).turn('revision',{},[record()],[initial,challenge])

    async def test_unverified_bmw_absence_is_rejected_for_any_feature(self):
        position=draft()['position'];position.update(agent_id='competitor',rationale="BMW's G60 lacks fast charging and battery swap.")
        position['claims'][0].update(kind='inference',text='BMW trim availability remains unverified in this evidence set.',evidence_ids=[])
        body=dict(agent_id='competitor',stage='perspectives',position=position,challenges=[],answered_claim_ids=[])
        class LLM:
            async def chat(inner,*args,**kwargs):return {'message':{'content':json.dumps(body)}}
        with self.assertRaisesRegex(AgentOutputError,'Do not assert any BMW equipment absence'):
            await GroundedParticipant('competitor',Settings.from_env(),LLM()).turn('perspectives',{},[record()],[])
