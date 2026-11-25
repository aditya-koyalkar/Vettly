from __future__ import annotations

import logging
from typing import Any, Literal

import aiohttp
from pydantic import BaseModel

from .config import Settings

logger = logging.getLogger("vettly.api")


class PlannedQuestion(BaseModel):
    id: str
    category: str
    topic: str
    question: str
    rationale: str
    followUps: list[str]
    evaluationCriteria: list[str]
    targetMinutes: float


class InterviewContext(BaseModel):
    sessionId: str
    candidateName: str
    jobTitle: str
    company: str
    type: str
    difficulty: str
    durationMinutes: int
    interviewerBrief: str
    focusAreas: list[str]
    questions: list[PlannedQuestion]


class TranscriptTurn(BaseModel):
    role: Literal["AGENT", "CANDIDATE"]
    content: str
    agentName: str | None = None
    offsetSec: float | None = None


class VettlyApi:
    """Client for the API's internal, service-key protected routes."""

    def __init__(self, settings: Settings, session_id: str) -> None:
        self._base = f"{settings.api_service_url.rstrip('/')}/api/internal/sessions/{session_id}"
        self._http = aiohttp.ClientSession(
            headers={"x-service-key": settings.api_service_key},
            timeout=aiohttp.ClientTimeout(total=15),
        )

    async def aclose(self) -> None:
        await self._http.close()

    async def _request(self, method: str, path: str, json: Any = None) -> Any:
        async with self._http.request(method, f"{self._base}{path}", json=json) as resp:
            if resp.status >= 400:
                body = await resp.text()
                raise RuntimeError(f"{method} {path} -> {resp.status}: {body[:300]}")
            return await resp.json()

    async def get_context(self) -> InterviewContext:
        return InterviewContext.model_validate(await self._request("GET", "/context"))

    async def search(self, query: str, scope: Literal["resume", "job", "both"] = "both") -> list[dict[str, Any]]:
        return await self._request("POST", "/search", {"query": query, "scope": scope})

    async def add_note(
        self, *, topic: str, observation: str, rating: int | None, question_id: str | None
    ) -> None:
        payload: dict[str, Any] = {"topic": topic, "observation": observation}
        if rating is not None:
            payload["rating"] = rating
        if question_id:
            payload["questionId"] = question_id
        await self._request("POST", "/notes", payload)

    async def complete(self, turns: list[TranscriptTurn], ended_reason: str) -> None:
        await self._request(
            "POST",
            "/complete",
            {"turns": [t.model_dump(exclude_none=True) for t in turns], "endedReason": ended_reason},
        )
