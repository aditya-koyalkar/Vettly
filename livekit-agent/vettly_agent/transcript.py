from __future__ import annotations

import time

from livekit.agents import AgentSession, ConversationItemAddedEvent, llm

from .api_client import TranscriptTurn


class TranscriptRecorder:
    """Captures every committed user/assistant message, tagged with the agent
    that was active, for post-call analysis."""

    def __init__(self, session: AgentSession) -> None:
        self._session = session
        self._started = time.time()
        self.turns: list[TranscriptTurn] = []
        session.on("conversation_item_added", self._on_item)

    def _on_item(self, event: ConversationItemAddedEvent) -> None:
        item = event.item
        if not isinstance(item, llm.ChatMessage) or item.role not in ("user", "assistant"):
            return
        text = (item.text_content or "").strip()
        if not text:
            return
        agent_name = None
        if item.role == "assistant":
            try:
                agent_name = self._session.current_agent.id
            except RuntimeError:
                agent_name = None
        self.turns.append(
            TranscriptTurn(
                role="AGENT" if item.role == "assistant" else "CANDIDATE",
                content=text,
                agentName=agent_name,
                offsetSec=round(max(0.0, event.created_at - self._started), 1),
            )
        )
