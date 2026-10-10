import asyncio
from uuid import uuid4, UUID
from fastapi import HTTPException
from backend.config import Settings
from backend.schemas.council import DebateRequest, DebateResult, CouncilTurn
from backend.storage import RunStore
from backend.council.participants import PARTICIPANTS

STAGES = ('perspectives', 'challenge', 'revision', 'assessment', 'review')

def load_proposal(request, settings):
    try: source = RunStore(settings.runs_dir).read(request.source_run_id)
    except FileNotFoundError as exc: raise HTTPException(404, 'Saved competitor analysis not found') from exc
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
    # Freshness must hold at debate time too, not only when analysis was created.
    sources = []
    for record in source.evidence:
        try: resolved = repository.read(record.id, source.scope)
        except ValueError as exc: raise HTTPException(409, 'Analysis evidence changed; rerun analysis.') from exc
        if resolved != record: raise HTTPException(409, 'Analysis evidence changed; rerun analysis.')
        if record.source_type == 'competitor_official' and not repository.is_current(record):
            raise HTTPException(409, 'Competitor evidence expired; refresh sources and rerun analysis.')
        sources.append(record)
    # Bound source context and retrieve customer counterevidence.
    for record in repository.search(source.scope.topic, source.scope, 'customer_feedback', limit=3):
        if record.id not in {r.id for r in sources}: sources.append(record)
    context = {'proposal':request.proposal.model_dump(), 'question':request.question,
               'scope':source.scope.model_dump(), 'recommendations':[r.model_dump() for r in source.recommendations],
               'limitations':source.uncertainties}
    turns = [CouncilTurn(agent_id='competitor',stage='perspectives',position=source.position)]
    # Assign globally stable references without modifying the persisted source.
    turns[0] = turns[0].model_copy(deep=True)
    for i,claim in enumerate(turns[0].position.claims): claim.id=f'competitor-perspectives-{i+1}'
    async with asyncio.timeout(900):
        for role in ('customer','market'):
            progress(f'{role.title()} agent: independent perspective')
            role_sources = [r for r in sources if (r.source_type == 'customer_feedback' if role == 'customer' else r.source_type == 'competitor_official')][:6]
            turns.append(await PARTICIPANTS[role](settings).turn('perspectives',context,role_sources,[]))
        progress('Customer agent: challenging the competitor position')
        turns.append(await PARTICIPANTS['customer'](settings).turn('challenge',context,sources,turns))
        progress('Competitor agent: responding and revising')
        turns.append(await PARTICIPANTS['competitor'](settings).turn('revision',context,sources,turns))
        progress('Judge: assessing disagreements and evidence')
        turns.append(await PARTICIPANTS['judge'](settings).turn('assessment',context,sources,turns))
    return DebateResult(run_id=str(uuid4()),source_run_id=source.run_id,analysis_id=source.analysis_id,
        proposal=request.proposal,scope=source.scope,question=request.question,model=settings.ollama_model,
        turns=turns,evidence=sources,limitations=[
        'Local Customer and Market Qwen role adapters are used; teammate implementations have not been merged.',
        'Market role has no sales or causal impact dataset and cannot estimate commercial success.',
        'BMW trim gaps remain unverified. AI grounding checks are fallible; PM review is required.',
        'One bounded challenge/revision round. No automatic feature approval.'])
