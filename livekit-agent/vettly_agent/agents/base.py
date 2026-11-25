from __future__ import annotations

from livekit.agents import Agent, llm

from ..state import InterviewState


class VettlyAgent(Agent):
    """Base for the interview stages: typed access to the shared state, and
    conversation carry-over across handoffs."""

    @property
    def state(self) -> InterviewState:
        return self.session.userdata

    def carried_context(self) -> llm.ChatContext:
        """The conversation so far, minus this stage's instructions and tool chatter,
        so the next stage keeps continuity without inheriting the wrong persona."""
        return self.chat_ctx.copy(exclude_instructions=True, exclude_function_call=True, exclude_handoff=True)
