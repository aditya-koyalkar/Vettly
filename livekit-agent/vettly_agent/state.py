from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Literal

from livekit import rtc

from .api_client import InterviewContext, PlannedQuestion, VettlyApi

logger = logging.getLogger("vettly.state")

Phase = Literal["greeting", "interview", "closing", "ended"]


@dataclass
class InterviewState:
    """Session userdata shared by the greeter, interviewer and closer agents."""

    context: InterviewContext
    api: VettlyApi
    room: rtc.Room
    phase: Phase = "greeting"
    #: Index into context.questions of the question currently being discussed.
    question_index: int = 0
    started_at: float | None = None
    ended_reason: str | None = None
    asked: list[str] = field(default_factory=list)

    @property
    def current_question(self) -> PlannedQuestion | None:
        qs = self.context.questions
        return qs[self.question_index] if self.question_index < len(qs) else None

    @property
    def elapsed_minutes(self) -> float:
        return 0.0 if self.started_at is None else (time.monotonic() - self.started_at) / 60

    @property
    def remaining_minutes(self) -> float:
        return max(0.0, self.context.durationMinutes - self.elapsed_minutes)

    def start_clock(self) -> None:
        if self.started_at is None:
            self.started_at = time.monotonic()

    def mark_asked(self) -> None:
        q = self.current_question
        if q and q.id not in self.asked:
            self.asked.append(q.id)

    def advance(self) -> PlannedQuestion | None:
        self.question_index += 1
        return self.current_question

    async def publish_progress(self, phase: Phase | None = None) -> None:
        """Exposes progress to the web UI through the agent's participant attributes."""
        if phase:
            self.phase = phase
        q = self.current_question
        attributes = {
            "vettly.phase": self.phase,
            "vettly.question_index": str(min(self.question_index + 1, len(self.context.questions))),
            "vettly.question_total": str(len(self.context.questions)),
            "vettly.topic": q.topic if q and self.phase == "interview" else "",
        }
        try:
            await self.room.local_participant.set_attributes(attributes)
        except Exception:  # UI hint only; never break the interview over it
            logger.debug("failed to publish progress attributes", exc_info=True)
