"""Local atomic run snapshots; use a shared database before multi-host deployment."""
from pathlib import Path
from uuid import UUID
from backend.schemas.agent import AgentResult

class RunStore:
    def __init__(self, directory: Path):
        self.directory = directory

    def save(self, result: AgentResult) -> None:
        name = str(UUID(result.run_id))
        self.directory.mkdir(parents=True, exist_ok=True)
        temporary = self.directory / f"{name}.tmp"
        temporary.write_text(result.model_dump_json(indent=2))
        temporary.replace(self.directory / f"{name}.json")

    def read(self, run_id: UUID) -> AgentResult:
        return AgentResult.model_validate_json((self.directory / f"{run_id}.json").read_text())
