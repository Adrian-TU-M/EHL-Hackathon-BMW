import json
import tempfile
import os
from datetime import date, timedelta
import unittest
from pathlib import Path
from unittest.mock import patch
import httpx
from backend.market.catalog import records_for, dashboard
from backend.market.refresh import inspect_source, refresh
from backend.market.studies import study_records
from backend.schemas.common import Scope

SCOPE=Scope(vehicle='G60',market='Europe',powertrain='Electric',horizon=4,topic='Controls')

class FeatureEvidenceTests(unittest.TestCase):
    def setUp(self):
        # Public catalog plus synthetic study fixtures; no private dataset required in CI.
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        data=json.loads(Path('backend/evidence/market.json').read_text())
        for r in data['records']:
            if r['source_type']=='industry_signal':r.update(verified_on=str(date.today()),review_due_on=str(date.today()+timedelta(days=30)),published_on=str(date.today()))
        for model,market in [('G60','Europe'),('G68','China'),('G70','China')]:
            data['records'].append(dict(id=f'study-{model}-{market}',source_type='customer_study',source_title='Synthetic test study',source_uri='local:fixture.xlsx',locator='Sheet!B24; sha256:fixture',passage='Synthetic reported mean.',retrieved_at='2026-01-01T00:00:00Z',brand='BMW study',model=model,market=market,categories=['controls'],caveats=[]))
        path=Path(self.temp.name)/'market.json';path.write_text(json.dumps(data))
        env=patch.dict(os.environ,{'MARKET_INDEX':str(path),'MARKET_SOURCE_CHECKS':str(Path(self.temp.name)/'checks.json')});env.start();self.addCleanup(env.stop)

    def test_feature_retrieval_keeps_matching_study_and_not_other_topics(self):
        rows=records_for(SCOPE,'Feature trends','cockpit');ids={r.id for r in rows}
        self.assertIn('bmw-panoramic',ids);self.assertIn('ncap-hmi-2026',ids)
        self.assertNotIn('nio-swap-milestone',ids)
        studies=[r for r in rows if r.source_type=='customer_study']
        self.assertTrue(studies)
        self.assertTrue(all(r.model=='G60' and r.market=='Europe' for r in studies))
        self.assertTrue(all(set(r.categories)&{'controls','infotainment'} for r in studies))
    def test_g68_studies_not_attributed_to_g60(self):
        rows=records_for(SCOPE.model_copy(update={'market':'China'}),'Feature trends','cockpit')
        self.assertFalse(any(r.source_type=='customer_study' for r in rows))
        rows=records_for(SCOPE.model_copy(update={'vehicle':'G70','market':'China'}),'Feature trends','cockpit')
        self.assertTrue(any(r.source_type=='customer_study' for r in rows))
    def test_unknown_feature_and_changed_page(self):
        with self.assertRaises(ValueError):records_for(SCOPE,'Feature trends','invented')
        with patch('backend.market.catalog.source_checks',return_value={'bmw-panoramic':{'status':'needs_review'}}):
            self.assertNotIn('bmw-panoramic',{r.id for r in records_for(SCOPE,'Feature trends','cockpit')})
    def test_features_have_real_unique_sources_and_study_locator(self):
        data=dashboard(SCOPE);ids={r['id'] for r in data['evidence']}
        self.assertEqual(len(data['features']),7)
        for f in data['features']:
            self.assertTrue(f['examples'])
            self.assertTrue(all(e['evidence_id'] in ids for e in f['examples']))
        for r in data['evidence']:
            if r['source_type']=='customer_study':self.assertIn('sha256:',r['locator'])

class PageCheckTests(unittest.IsolatedAsyncioTestCase):
    async def run_check(self,handler,anchors=['documented claim']):
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await inspect_source(client,{'source_uri':'https://example.com/article'},anchors)
    async def test_matching_text_is_not_semantic_verification(self):
        def handler(r):return httpx.Response(200,text='User-agent: *\nAllow: /' if r.url.path=='/robots.txt' else '<p>Documented claim</p>',headers={'Content-Type':'text/html'})
        result=await self.run_check(handler)
        self.assertEqual(result['status'],'text_matched');self.assertNotIn('verified_on',result)
    async def test_missing_text_requires_review(self):
        def handler(r):return httpx.Response(200,text='User-agent: *\nAllow: /' if r.url.path=='/robots.txt' else '<script>documented claim</script><p>other text</p>',headers={'Content-Type':'text/html'})
        self.assertEqual((await self.run_check(handler))['status'],'needs_review')
    async def test_robots_blocks_and_redirects_not_followed(self):
        calls=[]
        def denied(r):calls.append(r.url.path);return httpx.Response(200,text='User-agent: *\nDisallow: /')
        self.assertEqual((await self.run_check(denied))['status'],'blocked');self.assertEqual(calls,['/robots.txt'])
        def redirect(r):return httpx.Response(404) if r.url.path=='/robots.txt' else httpx.Response(302,headers={'Location':'http://127.0.0.1/private'})
        self.assertEqual((await self.run_check(redirect))['status'],'unavailable')
    async def test_oversized_response_and_unknown_url_rejected(self):
        def huge(r):return httpx.Response(404) if r.url.path=='/robots.txt' else httpx.Response(200,content=b'x'*3000001)
        self.assertEqual((await self.run_check(huge))['status'],'unavailable')
        with self.assertRaises(ValueError):await refresh(['https://127.0.0.1/private'])

class StudyGroundingTests(unittest.TestCase):
    def test_source_caveat_can_be_published_separately_without_licensing_overclaims(self):
        from backend.agents.market import required_source_limits, validate_text
        from backend.schemas.evidence import EvidenceRecord
        r=EvidenceRecord(id='study',source_type='customer_study',source_title='Test',source_uri='local:test',locator='E24',passage='Reported mean: 8.067.',retrieved_at='2026-01-01T00:00:00Z',brand='BMW',model='G60',market='Europe',caveats=['Rating scale is not documented here.'])
        limits=required_source_limits([r])
        self.assertEqual(len(limits),1)
        validate_text('\n'.join(['Test voice task completion before prioritizing a change.',*limits]),[r])
        with self.assertRaises(ValueError):
            validate_text('\n'.join(['The study shows high satisfaction.',*limits]),[r])
        with self.assertRaises(ValueError):
            validate_text('\n'.join(['This produces 87% success.',*limits]),[r])
        self.assertEqual(required_source_limits([]),[])

    def test_unknown_scale_interpretation_rejected(self):
        from backend.agents.market import validate_text
        from backend.schemas.evidence import EvidenceRecord
        r=EvidenceRecord(id='study',source_type='customer_study',source_title='Test',source_uri='local:test',locator='E24',passage='Reported mean: 8.067.',retrieved_at='2026-01-01T00:00:00Z',brand='BMW',model='G60',market='Europe',caveats=['Rating scale is not documented here.'])
        with self.assertRaises(ValueError):validate_text('Customer studies indicate satisfaction with current controls.',[r])
        with self.assertRaises(ValueError):validate_text('The scale is unknown, but the study shows high satisfaction.',[r])
        validate_text('The rating scale is unknown; test task completion directly.',[r])


class ValidationRegressionTests(unittest.TestCase):
    def source(self):
        from backend.schemas.evidence import EvidenceRecord
        return EvidenceRecord(id='source',source_type='industry_signal',source_title='Product announcement',source_uri='https://example.com/article',locator='Announcement',passage='The reported network has 70,000 points. The study mean is 8.100.',published_on='2025-07-16',retrieved_at='2026-10-10T12:00:00Z',brand='Example',model='Example',market='Global')
    def test_publication_year_and_equivalent_numbers_are_supported(self):
        from backend.agents.market import validate_text
        validate_text('The 2025 announcement reports 70000 points and a mean of 8.1.',[self.source()])
        with self.assertRaisesRegex(ValueError,'Unsupported numerical values: 87'):
            validate_text('Expected success is 87%.',[self.source()])
    def test_citation_identifiers_are_not_numeric_measurements(self):
        from backend.agents.market import validate_text
        rows=[self.source().model_copy(update={'id':eid}) for eid in ['feedback-G60-a648a350183c','feedback-G60-4def839cfc0a','study-Europe-G60-74']]
        citations=' '.join(r.id for r in rows)
        validate_text('Test update usability, supported by '+citations,rows)
        with self.assertRaisesRegex(ValueError,'Unsupported numerical values: 87'):
            validate_text('Expect 87% success, supported by '+citations,rows)

    def test_negated_satisfaction_is_not_a_positive_claim(self):
        from backend.agents.market import validate_text
        r=self.source().model_copy(update={'source_type':'customer_study','caveats':['Rating scale is not documented here.']})
        validate_text('The rating scale is unknown. The studies do not show high satisfaction.',[r])
        for claim in ['The unknown-scale study shows high satisfaction.', 'The rating scale is unknown, but the study shows high satisfaction.']:
            with self.assertRaises(ValueError):validate_text(claim,[r])

class RetryTests(unittest.IsolatedAsyncioTestCase):
    async def test_retry_preserves_failed_job_and_links_new_attempt(self):
        from backend.api.market import retry_job
        from unittest.mock import AsyncMock
        from uuid import UUID, uuid4
        old_id=str(uuid4());new_id=str(uuid4())
        previous={'id':old_id,'kind':'market_analysis','status':'failed','error':'original error','request':{'analysis_id':'test','client_job_id':old_id,'scope':SCOPE.model_dump(),'market_topic':'Feature trends','feature_id':'updates'}}
        replacement={'id':new_id,'status':'queued'}
        work=AsyncMock(return_value=replacement)
        with patch('backend.jobs.read',return_value=previous),patch('backend.jobs.save') as save,patch('backend.api.market.create_job',work):
            result=await retry_job(UUID(old_id))
        self.assertEqual(result,replacement)
        request=work.call_args.args[0]
        self.assertEqual(request.feature_id,'updates');self.assertEqual(request.scope,SCOPE)
        self.assertNotEqual(str(request.client_job_id),old_id)
        saved=save.call_args.args[0]
        self.assertEqual(saved['status'],'failed');self.assertEqual(saved['error'],'original error')
        self.assertEqual(saved['retry_job_id'],new_id)
        with patch('backend.jobs.read',side_effect=[saved,replacement]),patch('backend.api.market.create_job',work):
            self.assertEqual(await retry_job(UUID(old_id)),replacement)
        self.assertEqual(work.await_count,1)
