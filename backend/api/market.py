from uuid import UUID, uuid4
from fastapi import APIRouter, HTTPException, Query
from backend.config import Settings
from backend.schemas.common import Scope
from backend.market.catalog import dashboard, load_catalog, feature_for, records_for
from backend.agents.market import MarketAgent, MarketRequest
from backend.api.competitor import get_repository, status as shared_status
from backend.storage import RunStore
from backend.jobs import submit

router=APIRouter(prefix='/api/market',tags=['Market trends'])

@router.get('/status')
async def status():
    state=await shared_status()
    try:
        data=load_catalog();state.update(index_error=None,market_records=len(data['records']),as_of=data['as_of'])
        state['analysis_ready']=state['model_installed'];state['debate_ready']=bool(state['model_installed'] and state['evidence_records'])
    except (OSError,ValueError,KeyError) as exc:
        state.update(analysis_ready=False,debate_ready=False,index_error='Import market data first: python -m backend.market.ingest --data-dir <BMW-Data>')
    return state

@router.get('/dashboard')
async def get_dashboard(vehicle:str='G60',market:str='Europe',powertrain:str='Electric'):
    try:
        scope=Scope(vehicle=vehicle,market=market,powertrain=powertrain,horizon=4,topic='Market trends')
    except ValueError as exc:raise HTTPException(422,'Invalid market scope') from exc
    try:return dashboard(scope)
    except (OSError,ValueError,KeyError) as exc:raise HTTPException(503,'Market index unavailable. Run the market importer.') from exc

@router.post('/jobs',status_code=202)
async def create_job(request:MarketRequest):
    if request.stage!='analysis' or request.prior_positions or request.challenge:raise HTTPException(422,'Start debate explicitly through the council.')
    if request.competitor_brand or request.evidence_ids:raise HTTPException(422,'Market research uses the scoped market catalog.')
    if (request.market_topic=='Feature trends') != bool(request.feature_id): raise HTTPException(422,'Choose a feature for feature-trend analysis.')
    try:load_catalog()
    except (OSError,ValueError,KeyError) as exc:raise HTTPException(503,'Market index unavailable') from exc
    try:
        feature=feature_for(request.feature_id)
        if feature and not any(r.id in feature['evidence_ids'] for r in records_for(request.scope,request.market_topic,request.feature_id)):raise ValueError('No current feature sources for this scope')
    except ValueError as exc:raise HTTPException(422,str(exc)) from exc
    settings=Settings.from_env()
    try:repository=get_repository()
    except HTTPException:repository=None
    async def work(progress):
        result=await MarketAgent(settings,repository).run(request,progress)
        RunStore(settings.runs_dir).save(result);return result
    return await submit('market_analysis',request.model_dump(mode='json'),work,request.client_job_id)

@router.get('/runs/{run_id}')
async def get_run(run_id:UUID):
    try:result=RunStore(Settings.from_env().runs_dir).read(run_id)
    except FileNotFoundError as exc:raise HTTPException(404,'Analysis not found') from exc
    if result.position.agent_id!='market':raise HTTPException(404,'Market analysis not found')
    return result

@router.post('/sources/check')
async def check_sources(feature_id:str=Query(max_length=60)):
    from backend.market.refresh import refresh
    try:
        feature=feature_for(feature_id)
        if not feature:raise ValueError('Choose a feature')
        rules=load_catalog().get('source_checks',{})
        ids=[eid for eid in feature['evidence_ids'] if eid in rules]
        return await refresh(ids)
    except (OSError,KeyError) as exc:raise HTTPException(503,'Market source catalog unavailable') from exc
    except ValueError as exc:raise HTTPException(422,str(exc)) from exc


@router.post('/jobs/{job_id}/retry',status_code=202)
async def retry_job(job_id:UUID):
    from backend.jobs import read, save
    try: previous=read(job_id)
    except FileNotFoundError as exc:raise HTTPException(404,'Analysis job not found') from exc
    if previous['kind']!='market_analysis' or previous['status']!='failed':
        raise HTTPException(409,'Only a failed Market analysis can be retried here.')
    if previous.get('retry_job_id'):
        return read(previous['retry_job_id'])
    request=MarketRequest.model_validate({**previous['request'],'client_job_id':str(uuid4())})
    replacement=await create_job(request)
    # Keep the original failure for audit; reloads can follow its new attempt.
    previous['retry_job_id']=replacement['id'];save(previous)
    return replacement
