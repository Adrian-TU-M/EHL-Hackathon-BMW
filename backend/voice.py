"""ElevenLabs speaks saved Qwen Judge output; it never generates a decision."""
import asyncio
import hashlib
import os
import re
from uuid import UUID

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict

from backend.config import Settings
from backend.council.judge import load_review, assessment_text
from backend.judge.models import JudgeAssessment

router = APIRouter(prefix="/api/voice", tags=["Judge voice"])
_audio_locks: dict[str, asyncio.Lock] = {}


def configuration():
    return {
        "key": os.getenv("ELEVENLABS_API_KEY", "").strip(),
        "voice_id": os.getenv("ELEVENLABS_VOICE_ID", "JBFqnCBsd6RMkjVDRZzb").strip(),
        "model_id": os.getenv("ELEVENLABS_MODEL_ID", "eleven_flash_v2_5").strip(),
    }


@router.get("/status")
async def status():
    config = configuration()
    return {"configured": bool(config["key"] and config["voice_id"]), "provider": "ElevenLabs",
        "model": config["model_id"], "voice_id": config["voice_id"],
        "message": "Voice is configured; playback checks provider access." if config["key"] else "Add ELEVENLABS_API_KEY to backend/.env to enable Judge voice. Local Qwen analysis and PM review remain available."}


class VoiceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message_id: UUID | None = None
    assessment_id: str | None = None


def saved_speech(review, body):
    if body.message_id:
        message = next((item for item in review["messages"] if item["id"] == str(body.message_id) and item["actor"] == "judge"), None)
        if message is None:
            raise HTTPException(404, "Saved Judge reply not found")
        return message["text"]
    assessment = review.get("assessment")
    if not assessment:
        raise HTTPException(409, "Reassess the edited requirement before playing its Judge verdict")
    if body.assessment_id and body.assessment_id != assessment["id"]:
        raise HTTPException(409, "The assessment changed; refresh before playing its voice")
    return assessment_text(JudgeAssessment.model_validate(assessment))


async def synthesize(text, settings=None, transport=None):
    config = configuration()
    if not config["key"]:
        raise HTTPException(503, "Judge voice needs ELEVENLABS_API_KEY in backend/.env. The Qwen assessment is already available as text.")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", config["voice_id"]):
        raise HTTPException(503, "ELEVENLABS_VOICE_ID is invalid")
    if len(text) > 18000:
        raise HTTPException(422, "This saved Judge response is too long for one voice request")
    digest = hashlib.sha256((config["voice_id"] + "\0" + config["model_id"] + "\0" + text).encode()).hexdigest()
    path = (settings or Settings.from_env()).runs_dir / "voice" / f"{digest}.mp3"
    async with _audio_locks.setdefault(digest, asyncio.Lock()):
        if path.exists():
            return path
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(90, connect=10), transport=transport) as client:
                async with client.stream("POST", f"https://api.elevenlabs.io/v1/text-to-speech/{config['voice_id']}",
                    params={"output_format": "mp3_44100_128"}, headers={"xi-api-key": config["key"], "Accept": "audio/mpeg"},
                    json={"text": text, "model_id": config["model_id"]}) as response:
                    if response.status_code in (401, 403):
                        raise HTTPException(503, "ElevenLabs rejected the backend key or voice access. Check API permissions.")
                    if response.status_code in (402, 429):
                        raise HTTPException(503, "ElevenLabs credits or rate limit prevent playback. The saved assessment remains available.")
                    if not response.is_success:
                        raise HTTPException(502, f"ElevenLabs voice request failed ({response.status_code}). Check voice and model configuration.")
                    if not response.headers.get("content-type", "").startswith("audio/"):
                        raise HTTPException(502, "ElevenLabs did not return playable audio")
                    audio = bytearray()
                    async for chunk in response.aiter_bytes():
                        audio.extend(chunk)
                        if len(audio) > 12_000_000:
                            raise HTTPException(502, "ElevenLabs audio exceeded the playback limit")
            if not audio:
                raise HTTPException(502, "ElevenLabs returned empty audio")
        except httpx.HTTPError as exc:
            raise HTTPException(503, "Cannot reach ElevenLabs. Check internet access and retry voice playback.") from exc
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".tmp")
        temporary.write_bytes(audio)
        temporary.replace(path)
    return path


@router.post("/debates/{run_id}")
async def speak(run_id: UUID, body: VoiceRequest):
    review = load_review(run_id)
    path = await synthesize(saved_speech(review, body))
    return FileResponse(path, media_type="audio/mpeg", headers={"Cache-Control": "private, max-age=3600"})
