"""Explicit live smoke run: python -m backend.smoke (requires local Ollama and index)."""
import asyncio
import json
import time
import argparse
import httpx
from backend.agents.competitor import CompetitorAgent
from backend.config import Settings
from backend.schemas.agent import AgentRequest
from backend.storage import RunStore
from backend.tools.retrieval import EvidenceRepository

async def main(api_url: str | None = None):
    settings = Settings.from_env()
    repository = EvidenceRepository.load(settings.evidence_index)
    request = AgentRequest(analysis_id='live-display-check', scope={
        'vehicle': 'G60', 'market': 'Europe', 'powertrain': 'Electric',
        'horizon': 4, 'topic': 'Displays',
    })
    start = time.monotonic()
    if api_url:
        async with httpx.AsyncClient(timeout=settings.agent_timeout_seconds + 30) as client:
            response = await client.post(api_url.rstrip('/') + '/api/competitor/analyze', json=request.model_dump(mode='json'))
            if response.is_error:
                raise RuntimeError(f'HTTP {response.status_code}: {response.text}')
            from backend.schemas.agent import AgentResult
            result = AgentResult.model_validate(response.json())
            saved = await client.get(api_url.rstrip('/') + '/api/competitor/runs/' + result.run_id)
            saved.raise_for_status()
            assert saved.json() == response.json(), 'Saved run differs from response'
    else:
        result = await CompetitorAgent(settings, repository).run(request)
        RunStore(settings.runs_dir).save(result)
    print(json.dumps({'elapsed_seconds': round(time.monotonic()-start, 1),
                     'run_id': result.run_id, 'stance': result.position.stance,
                     'recommendations': [r.title for r in result.recommendations],
                     'research_steps': result.research_steps,
                     'evidence_count': len(result.evidence)}, indent=2))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--api-url', help='Test HTTP analysis and persisted read-back against a running backend')
    asyncio.run(main(parser.parse_args().api_url))
