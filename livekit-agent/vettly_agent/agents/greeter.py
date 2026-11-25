from __future__ import annotations

from livekit.agents import function_tool

from ..api_client import InterviewContext
from ..prompts import greeter_instructions
from .base import VettlyAgent


class GreeterAgent(VettlyAgent):
    """Opens the call: rapport, format, readiness check. Hands off to the interviewer."""

    def __init__(self, context: InterviewContext) -> None:
        super().__init__(instructions=greeter_instructions(context))

    async def on_enter(self) -> None:
        await self.state.publish_progress("greeting")
        self.session.generate_reply(instructions="Greet the candidate and explain the format now.")

    @function_tool
    async def start_interview(self):
        """Call when the candidate confirms they are ready to begin the interview."""
        from .interviewer import InterviewerAgent

        self.state.start_clock()
        return InterviewerAgent(self.state.context, chat_ctx=self.carried_context()), "Starting the interview."
