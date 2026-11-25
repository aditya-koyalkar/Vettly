from __future__ import annotations

import asyncio
import logging

from livekit.agents import RunContext, function_tool, get_job_context, llm

from ..api_client import InterviewContext
from ..prompts import closer_instructions
from .base import VettlyAgent

logger = logging.getLogger("vettly.closer")


class CloserAgent(VettlyAgent):
    """Thanks the candidate, fields one question, and ends the call."""

    def __init__(self, context: InterviewContext, *, chat_ctx: llm.ChatContext | None = None) -> None:
        super().__init__(instructions=closer_instructions(context), chat_ctx=chat_ctx)

    async def on_enter(self) -> None:
        await self.state.publish_progress("closing")
        self.session.generate_reply(instructions="Begin the wrap-up now.")

    @function_tool
    async def end_interview(self, context: RunContext) -> None:
        """End the call after you have said goodbye."""
        state = self.state
        state.ended_reason = state.ended_reason or "completed"
        await state.publish_progress("ended")
        # Let the goodbye finish playing before tearing down the room. (Waiting on
        # the session's current SpeechHandle here would deadlock: it includes this
        # very tool call.) Deleting the room triggers the shutdown hook that
        # submits the transcript.
        await context.wait_for_playout()
        await asyncio.sleep(0.5)
        get_job_context().delete_room()
