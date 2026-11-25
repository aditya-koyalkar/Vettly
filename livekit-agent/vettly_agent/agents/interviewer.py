from __future__ import annotations

import logging
from typing import Annotated, Literal

from livekit.agents import ToolError, function_tool, llm
from pydantic import Field

from ..api_client import InterviewContext, PlannedQuestion
from ..prompts import interviewer_instructions
from .base import VettlyAgent

logger = logging.getLogger("vettly.interviewer")

#: Below this many minutes, stop opening new questions and wrap up.
WRAP_UP_THRESHOLD_MIN = 1.5


def _question_brief(q: PlannedQuestion, remaining: float, position: int, total: int) -> str:
    return (
        f"Question {position} of {total} [{q.id}], topic: {q.topic}. Ask this now in your own words: "
        f'"{q.question}" Possible follow-ups: {" | ".join(q.followUps)}. '
        f"About {remaining:.0f} minutes remain in the interview."
    )


class InterviewerAgent(VettlyAgent):
    """Runs the planned questions with follow-ups, using RAG and note-taking tools."""

    def __init__(self, context: InterviewContext, *, chat_ctx: llm.ChatContext | None = None) -> None:
        super().__init__(instructions=interviewer_instructions(context), chat_ctx=chat_ctx)

    async def on_enter(self) -> None:
        self.state.start_clock()
        await self.state.publish_progress("interview")
        q = self.state.current_question
        if q is None:
            await self._hand_to_closer()
            return
        self.state.mark_asked()
        total = len(self.state.context.questions)
        self.session.generate_reply(
            instructions=_question_brief(q, self.state.remaining_minutes, self.state.question_index + 1, total)
        )

    @function_tool
    async def next_question(self) -> str:
        """Move on to the next planned question once the current one (and any follow-ups) is done,
        or when the candidate asks to skip."""
        state = self.state
        if state.remaining_minutes < WRAP_UP_THRESHOLD_MIN:
            return "Time is nearly up. Do not ask another question; call wrap_up now."
        q = state.advance()
        await state.publish_progress()
        if q is None:
            return "That was the last planned question. Call wrap_up now."
        state.mark_asked()
        return _question_brief(q, state.remaining_minutes, state.question_index + 1, len(state.context.questions))

    @function_tool
    async def search_candidate_background(
        self,
        query: Annotated[str, Field(description="What to look up, e.g. 'payments migration project scale'")],
        scope: Annotated[
            Literal["resume", "job", "both"],
            Field(description="Search the candidate's resume, the job description, or both"),
        ] = "both",
    ) -> str:
        """Search the candidate's resume and the job description for specifics, to ask a sharper,
        personalised question. Use sparingly; do not read results aloud verbatim."""
        try:
            hits = await self.state.api.search(query, scope)
        except Exception as e:
            logger.warning("RAG search failed: %s", e)
            raise ToolError("Background search is unavailable right now; continue without it.") from e
        if not hits:
            return "No relevant passages found."
        return "\n\n".join(f"[{h['source']}{' / ' + h['section'] if h.get('section') else ''}] {h['content']}" for h in hits)

    @function_tool
    async def record_observation(
        self,
        topic: Annotated[str, Field(description="Short label, e.g. 'Postgres indexing'")],
        observation: Annotated[str, Field(description="Factual note on what the answer showed or lacked")],
        rating: Annotated[int, Field(ge=1, le=5, description="1 = weak, 3 = meets bar, 5 = exceptional")],
    ) -> str:
        """Silently record an observation about the candidate's latest answer for the final report."""
        q = self.state.current_question
        try:
            await self.state.api.add_note(
                topic=topic, observation=observation, rating=rating, question_id=q.id if q else None
            )
        except Exception:
            # Notes only enrich the report; the transcript is the source of truth.
            logger.warning("failed to record observation", exc_info=True)
        return "Noted. Continue the interview without mentioning this."

    @function_tool
    async def wrap_up(self):
        """End the question phase: all questions are done, time is up, or the candidate asked to stop."""
        return self._closer(), "Moving to the wrap-up."

    async def _hand_to_closer(self) -> None:
        """Handoff outside a tool call (empty plan, or the session clock ran out)."""
        self.session.update_agent(self._closer())

    def _closer(self):
        from .closer import CloserAgent

        return CloserAgent(self.state.context, chat_ctx=self.carried_context())
