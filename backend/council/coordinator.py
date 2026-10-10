import asyncio
from uuid import uuid4, UUID
from fastapi import HTTPException
from backend.config import Settings
from backend.schemas.council import DebateRequest, DebateResult, CouncilTurn
from backend.storage import RunStore
from backend.council.participants import PARTICIPANTS
from backend.market.catalog import records_for

STAGES = ('perspectives', 'challenge', 'revision', 'assessment', 'review')


def _collect_evidence(participant, sources):
    """Carry native specialist citations through to the judge and persisted result."""
    indexed = {record.id: record for record in sources}
    for record in getattr(participant, 'evidence', []):
        if record.id in indexed and indexed[record.id] != record:
            raise HTTPException(409, 'A specialist returned conflicting evidence for an existing source ID.')
        if record.id not in indexed:
            sources.append(record)
            indexed[record.id] = record


def _snapshot(value):
    return value.model_dump(mode='json') if value is not None else None

def load_proposal(request, settings):
    try: source = RunStore(settings.runs_dir).read(request.source_run_id)
    except FileNotFoundError as exc: raise HTTPException(404, 'Saved analysis not found') from exc
    if source.analysis_id != request.analysis_id or source.scope != request.scope:
        raise HTTPException(409, 'The saved analysis scope does not match this debate.')
    if request.proposal.proposal_id != source.run_id or request.proposal.version != 1:
        raise HTTPException(409, 'Proposal reference is stale. Use the immutable analysis run ID and version 1.')
    if source.model != settings.ollama_model:
        raise HTTPException(409, 'Analysis model differs from the shared council model. Rerun the analysis.')
    return source

async def start_debate(request: DebateRequest, repository, progress=lambda _:None, settings=None) -> DebateResult:
    settings = settings or Settings.from_env()
    source = load_proposal(request, settings)
    lead = source.position.agent_id
    if lead not in ('competitor','market'): raise HTTPException(422,'Unsupported proposal agent')
    try: market_sources = records_for(source.scope,source.market_topic,source.feature_id) if source.feature_id else records_for(source.scope,source.market_topic)
    except (OSError,ValueError,KeyError) as exc: raise HTTPException(503,'Market evidence unavailable; import market data before debate.') from exc
    market_by_id={r.id:r for r in market_sources}
    # Freshness must hold at debate time too, not only when analysis was created.
    sources = []
    for record in source.evidence:
        try: resolved = market_by_id[record.id] if record.source_type in ('market_metric','industry_signal','planning_volume','customer_study') else repository.read(record.id, source.scope)
        except (ValueError,KeyError) as exc: raise HTTPException(409, 'Analysis evidence changed or expired; rerun analysis.') from exc
        if resolved != record: raise HTTPException(409, 'Analysis evidence changed; rerun analysis.')
        if record.source_type == 'competitor_official' and not repository.is_current(record):
            raise HTTPException(409, 'Competitor evidence expired; refresh sources and rerun analysis.')
        sources.append(record)
    for record in market_sources:
        if record.id not in {r.id for r in sources}: sources.append(record)
    # Bound source context and retrieve customer counterevidence.
    for record in repository.search(source.scope.topic, source.scope, 'customer_feedback', limit=3):
        if record.id not in {r.id for r in sources}: sources.append(record)
    if lead == 'market':
        for record in repository.search(source.scope.topic, source.scope, 'competitor_official', limit=3):
            if record.id not in {r.id for r in sources}: sources.append(record)
    context = {'lead_agent':lead, 'feature_id':source.feature_id, 'proposal':request.proposal.model_dump(), 'question':request.question,
               'scope':source.scope.model_dump(), 'recommendations':[r.model_dump() for r in source.recommendations],
               'limitations':source.uncertainties}
    turns = [CouncilTurn(agent_id=lead,stage='perspectives',position=source.position)]
    # Assign globally stable references without modifying the persisted source.
    turns[0] = turns[0].model_copy(deep=True)
    for i,claim in enumerate(turns[0].position.claims): claim.id=f'{lead}-perspectives-{i+1}'
    moderation = []
    moderator = PARTICIPANTS['moderator'](settings) if 'moderator' in PARTICIPANTS else None
    judge = None
    async with asyncio.timeout(1800):
        if moderator:
            progress('Moderator: framing the PM question and specialist tasks')
            moderation.append(await moderator.turn('perspectives',context,sources,[]))
            context['moderator_framing'] = moderation[-1].position.rationale
        for role in [r for r in ('customer','market','competitor') if r!=lead]:
            progress(f'{role.title()} agent: independent perspective')
            role_sources = [r for r in sources if (r.source_type in ('customer_feedback','customer_study') if role == 'customer' else r.source_type in ('market_metric','industry_signal','planning_volume','customer_study') if role=='market' else r.source_type=='competitor_official')][:9]
            participant = PARTICIPANTS[role](settings)
            turns.append(await participant.turn('perspectives',context,role_sources,[]))
            _collect_evidence(participant, sources)
        challenger='customer' if lead=='market' else 'market'
        progress(f'{challenger.title()} agent: challenging the {lead} position')
        participant = PARTICIPANTS[challenger](settings)
        turns.append(await participant.turn('challenge',context,sources,turns))
        _collect_evidence(participant, sources)
        progress(f'{lead.title()} agent: responding and revising')
        participant = PARTICIPANTS[lead](settings)
        turns.append(await participant.turn('revision',context,sources,turns))
        _collect_evidence(participant, sources)
        progress('Judge: assessing disagreements and evidence')
        judge = PARTICIPANTS['judge'](settings)
        turns.append(await judge.turn('assessment',context,sources,turns))
        if moderator:
            progress('Moderator: closing the debate for PM review')
            moderation.append(await moderator.turn('assessment',context,sources,turns))
    return DebateResult(run_id=str(uuid4()),source_run_id=source.run_id,analysis_id=source.analysis_id,
        proposal=request.proposal,scope=source.scope,question=request.question,model=settings.ollama_model,
        turns=turns,moderation=moderation,evidence=sources,
        judge_assessment=_snapshot(getattr(judge,'assessment',None)),
        judge_request=_snapshot(getattr(judge,'request',None)),limitations=[
        'Customer, Market, Competitor, Moderator and Judge use the shared local Qwen runtime. The Judge applies the integrated scoring rubric to the actual specialist debate.',
        'Market data describes adoption and volume, not causal feature impact or commercial success probability.',
        'BMW trim gaps remain unverified. AI grounding checks are fallible; PM review is required.',
        'One bounded challenge/revision round. No automatic feature approval.'])
