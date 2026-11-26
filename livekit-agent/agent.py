"""Vettly voice interviewer: LiveKit agent worker entrypoint.

Run locally:   uv run agent.py dev
Production:    uv run agent.py start
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys

from dotenv import load_dotenv
from livekit.agents import (
    AgentServer,
    AgentSession,
    CloseEvent,
    JobContext,
    JobProcess,
    UserStateChangedEvent,
    cli,
    inference,
    room_io,
)

from vettly_agent.agents import CloserAgent, GreeterAgent
from vettly_agent.agents.base import VettlyAgent
from vettly_agent.api_client import InterviewContext, VettlyApi
from vettly_agent.config import get_settings
from vettly_agent.models import build_llm, build_stt, build_tts, build_vad
from vettly_agent.state import InterviewState
from vettly_agent.transcript import TranscriptRecorder

load_dotenv()
logger = logging.getLogger("vettly.worker")
settings = get_settings()

#: How often the watchdog checks the interview clock.
CLOCK_TICK_SEC = 5


def _session_keyterms(interview: InterviewContext) -> list[str]:
    """Boost recognition of role, company, and domain terms without hitting keyterm caps."""
    raw = [interview.jobTitle, interview.company, *interview.focusAreas, *(q.topic for q in interview.questions)]
    terms: list[str] = []
    seen: set[str] = set()
    for item in raw:
        term = item.strip()
        if not term or len(term) > 40:
            continue
        key = term.lower()
        if key not in seen:
            seen.add(key)
            terms.append(term)
        if len(terms) >= 15:
            break
    return terms


def prewarm(proc: JobProcess) -> None:
    # Load the VAD once per worker process, not per call.
    proc.userdata["vad"] = build_vad()


server = AgentServer(setup_fnc=prewarm)


@server.rtc_session(agent_name=settings.agent_name)
async def entrypoint(ctx: JobContext) -> None:
    session_id = json.loads(ctx.job.metadata or "{}").get("sessionId")
    if not session_id:
        logger.error("job dispatched without a sessionId; refusing")
        ctx.shutdown("missing session id")
        return
    ctx.log_context_fields = {"session_id": session_id, "room": ctx.room.name}

    api = VettlyApi(settings, session_id)
    try:
        interview = await api.get_context()
    except Exception:
        logger.exception("could not load interview context")
        await api.aclose()
        ctx.shutdown("context unavailable")
        return

    state = InterviewState(context=interview, api=api, room=ctx.room)
    vad = ctx.proc.userdata["vad"]

    session = AgentSession[InterviewState](
        stt=build_stt(settings, vad),
        llm=build_llm(settings),
        tts=build_tts(settings),
        vad=vad,
        userdata=state,
        turn_handling={
            # Semantic end-of-turn model: tells "I'm thinking..." pauses apart from
            # finished answers. Cloud model with on-device fallback.
            "turn_detection": inference.TurnDetector(),
            # Leave enough headroom above VAD (0.55s) + Deepgram (450ms + lookahead)
            # so trailing words finalize inside the turn rather than arriving after commit.
            "endpointing": {"mode": "dynamic", "min_delay": 1.6, "max_delay": 5.0},
            # Stop immediately on real user speech (>= 0.5s) and never drop transcripts
            # in an adaptive backchannel gate or auto-resume over the candidate.
            "interruption": {
                "mode": "vad",
                "min_duration": 0.5,
                "min_words": 0,
                "resume_false_interruption": False,
            },
            # Wait for complete turns so thinking pauses don't trigger speculative LLM/tool calls.
            "preemptive_generation": {"enabled": False},
        },
        stt_context_options={
            "keyterms": _session_keyterms(interview),
            "forward_chat_context": False,
        },
        # Browser WebRTC already does AEC; 3.0s default makes the agent deaf at turn start.
        aec_warmup_duration=0.4,
        max_tool_steps=4,
        user_away_timeout=35.0,
    )
    recorder = TranscriptRecorder(session)

    submitted = asyncio.Event()

    async def submit_transcript(reason: str = "shutdown") -> None:
        if submitted.is_set():
            return
        submitted.set()
        try:
            await api.complete(recorder.turns, state.ended_reason or reason)
            logger.info("submitted transcript (%d turns)", len(recorder.turns))
        except Exception:
            logger.exception("failed to submit transcript")
        finally:
            await api.aclose()

    ctx.add_shutdown_callback(submit_transcript)

    @session.on("user_state_changed")
    def _on_user_state(ev: UserStateChangedEvent) -> None:
        if ev.new_state == "away" and state.phase in ("greeting", "interview"):
            session.generate_reply(
                instructions="The candidate has been silent for a while. Gently check if they are still there "
                "or need the question repeated."
            )

    @session.on("close")
    def _on_close(ev: CloseEvent) -> None:
        if ev.error:
            logger.error("session closed with error: %s", ev.error)
            state.ended_reason = state.ended_reason or f"error: {type(ev.error).__name__}"
        else:
            state.ended_reason = state.ended_reason or str(ev.reason)
        ctx.shutdown(state.ended_reason)

    async def clock_watchdog() -> None:
        """Enforces the time box even if the LLM forgets to call wrap_up."""
        while state.phase != "ended":
            await asyncio.sleep(CLOCK_TICK_SEC)
            if state.phase == "interview" and state.remaining_minutes <= 0:
                logger.info("time limit reached; handing off to closer")
                state.ended_reason = "time limit"
                current = session.current_agent
                carried = current.carried_context() if isinstance(current, VettlyAgent) else None
                session.update_agent(CloserAgent(interview, chat_ctx=carried))
                return

    await session.start(
        agent=GreeterAgent(interview),
        room=ctx.room,
        room_options=room_io.RoomOptions(
            # Match Deepgram/VAD 16kHz directly and disable server-side AGC so it doesn't
            # fight browser WebRTC AGC or duck softer syllables mid-sentence.
            audio_input=room_io.AudioInputOptions(sample_rate=16000, auto_gain_control=False),
            close_on_disconnect=True,
        ),
    )
    watchdog = asyncio.create_task(clock_watchdog())
    ctx.add_shutdown_callback(lambda: _cancel(watchdog))


async def _cancel(task: asyncio.Task[None]) -> None:
    task.cancel()


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] != "download-files" and not settings.api_service_key:
        raise RuntimeError("API_SERVICE_KEY must be set before starting the worker")
    cli.run_app(server)
