from fastapi import APIRouter, Depends
from backend.config import Settings
from backend.api.competitor import get_repository
from backend.council.coordinator import start_debate, load_proposal
from backend.schemas.council import DebateRequest
from backend.tools.retrieval import EvidenceRepository
from backend.jobs import submit

router = APIRouter(prefix='/api/council', tags=['Council'])

@router.post('/debate', status_code=202)
async def debate(request: DebateRequest, repository: EvidenceRepository = Depends(get_repository)):
    # Explicit PM action is a local workflow gate, not production authentication.
    settings = Settings.from_env()
    load_proposal(request, settings)
    async def work(progress):
        return await start_debate(request, repository, progress, settings)
    return await submit('debate', request.model_dump(mode='json'), work, request.client_job_id)
