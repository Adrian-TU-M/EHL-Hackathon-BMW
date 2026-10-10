"""Persist job progress; inference stays on this single team laptop.

A server restart marks unfinished jobs interrupted. It never silently replays a
PM debate or pretends a partially generated result completed.
"""
import asyncio
import json
import logging
from datetime import datetime, timezone
from uuid import uuid4, UUID
from fastapi import APIRouter, HTTPException
from backend.config import Settings
from backend.runtime import run_lock

router = APIRouter(prefix="/api/jobs", tags=["Live jobs"])
tasks: dict[str, asyncio.Task] = {}

def path(job_id):
    return Settings.from_env().runs_dir / "jobs" / (str(UUID(str(job_id))) + ".json")

def save(job):
    p = path(job['id']); p.parent.mkdir(parents=True, exist_ok=True)
    temporary = p.with_suffix('.tmp'); temporary.write_text(json.dumps(job, ensure_ascii=False, indent=2)); temporary.replace(p)

def read(job_id):
    job = json.loads(path(job_id).read_text())
    if job['status'] in ('queued', 'running') and str(job_id) not in tasks:
        job.update(status='failed', error='Server restarted during this run. Start a new run explicitly.', phase='Interrupted')
        save(job)
    return job

async def submit(kind, request, work, job_id=None):
    if job_id is not None and path(job_id).exists():
        existing = read(job_id)
        if existing["kind"] != kind or existing["request"] != request:
            raise HTTPException(409, "Job ID already belongs to a different request.")
        return existing
    # No await between check and reservation: atomic within our single event loop.
    if run_lock.locked() or any(not t.done() for t in tasks.values()):
        raise HTTPException(409, 'Another live analysis or debate is running on this laptop.')
    job = dict(id=str(job_id or uuid4()), kind=kind, status='queued', phase='Queued', request=request,
               created_at=datetime.now(timezone.utc).isoformat(), result=None, error=None)
    save(job)
    def progress(phase):
        job['phase'] = phase; save(job)
    async def execute():
        try:
            async with run_lock:
                job['status'] = 'running'; progress('Reading evidence')
                result = await work(progress)
                job.update(status='succeeded', phase='Complete', result=result.model_dump(mode='json'))
        except asyncio.CancelledError:
            job.update(status='failed', phase='Interrupted', error='Backend stopped during this run. Retry explicitly.')
            raise
        except Exception as exc:
            logging.getLogger(__name__).exception('Live %s job failed', kind)
            failed_phase = job['phase']
            detail = str(exc)[:600] or type(exc).__name__
            job.update(status='failed', phase='Failed', error=f'{failed_phase}: {detail}')
        finally:
            save(job); tasks.pop(job['id'], None)
    tasks[job['id']] = asyncio.create_task(execute())
    return job

@router.get('/{job_id}')
async def get_job(job_id: UUID):
    try: return read(job_id)
    except FileNotFoundError as exc: raise HTTPException(404, 'Job not found') from exc
