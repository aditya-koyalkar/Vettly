from __future__ import annotations

from livekit.agents import function_tool

from ..api_client import InterviewContext
from ..prompts import greeter_instructions
from .base import VettlyAgent


class GreeterAgent(VettlyAgent):
    """Opens the call with a warm greeting and asks for the candidate's introduction."""

    def __init__(self, context: InterviewContext) -> None:
        super().__init__(instructions=greeter_instructions(context))

    async def on_enter(self) -> None:
        await self.state.publish_progress("greeting")
        self.session.generate_reply(
            instructions=(
                "Greet the candidate warmly in one short sentence, say you will be taking their "
                "interview today, and ask them to introduce themselves."
            )
        )

    @function_tool
    async def start_interview(self):
        """Call right after the candidate finishes their introduction (or confirms they are ready)."""
        from .interviewer import InterviewerAgent

        self.state.start_clock()
        return InterviewerAgent(self.state.context, chat_ctx=self.carried_context())
