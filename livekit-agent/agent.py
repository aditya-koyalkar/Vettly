"""Vettly voice interviewer: LiveKit agent worker entrypoint.

Run locally:   uv run agent.py dev
Production:    uv run agent.py start
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import sys

from dotenv import load_dotenv
from livekit.agents import (
    AgentServer,
    AgentSession,
    CloseEvent,
    ErrorEvent,
    JobContext,
    JobProcess,
    UserInputTranscribedEvent,
    UserStateChangedEvent,
    cli,
    room_io,
    stt,
)

from vettly_agent.agents import CloserAgent, GreeterAgent
from vettly_agent.agents.base import VettlyAgent
from vettly_agent.api_client import InterviewContext, VettlyApi
from vettly_agent.config import get_settings
from vettly_agent.models import (
    DEEPGRAM_STT_SAMPLE_RATE,
    build_llm,
    build_noise_cancellation,
    build_stt,
    build_tts,
    build_vad,
)
from vettly_agent.state import InterviewState
from vettly_agent.transcript import TranscriptRecorder

load_dotenv()
logger = logging.getLogger("vettly.worker")
settings = get_settings()

#: How often the watchdog checks the interview clock.
CLOCK_TICK_SEC = 5


_KEYTERM_STOPWORDS = frozenset(
    {
        "after",
        "and",
        "can",
        "could",
        "for",
        "how",
        "in",
        "moving",
        "specifically",
        "tell",
        "the",
        "this",
        "walk",
        "what",
        "when",
        "where",
        "which",
        "while",
        "why",
        "you",
        "your",
    }
)
_TECH_TOKEN_RE = re.compile(r"\b(?:[A-Z][A-Za-z0-9.+#-]{1,}|[a-z]+[A-Z][A-Za-z0-9]*)\b")
# Tokens that are clearly technical regardless of position: acronyms, camelCase/
# PascalCase with an inner capital, or containing digits / . + # (e.g. "Node.js", "C++").
_STRONG_TECH_RE = re.compile(r"^(?:[A-Z0-9]{2,}s?|.*[a-z][A-Z].*|.*[0-9.+#].*)$")
_SENTENCE_START_RE = re.compile(r"(?:^|[.!?:;\n]\s*|[\"'(]\s*)$")


def _tech_tokens(text: str) -> list[str]:
    """Capitalized/technical tokens, skipping plain capitalized words that only start
    a sentence ("Describe", "Imagine"): boosting those as keyterms skews Deepgram."""
    out: list[str] = []
    for m in _TECH_TOKEN_RE.finditer(text):
        token = m.group(0)
        if not _STRONG_TECH_RE.match(token) and _SENTENCE_START_RE.search(text[: m.start()]):
            continue
        out.append(token)
    return out


_GENERIC_INTERVIEW_KEYTERMS: tuple[str, ...] = (
    "migrate",
    "migration",
    "deploy",
    "deployment",
    "architecture",
    "microservices",
    "monolith",
    "latency",
    "throughput",
    "scalability",
    "database",
    "cache",
    "caching",
    "API",
    "endpoint",
    "authentication",
    "authorization",
    "webhook",
    "pipeline",
    "trade-off",
    "bottleneck",
    "incident",
    "rollback",
    "refactor",
    "debugging",
    "production",
    "staging",
    "stakeholder",
    "ownership",
    "cross-functional",
)


def _session_keyterms(interview: InterviewContext) -> list[str]:
    """Extract role, company, JD/resume, and generic interview terms for STT keyterm boosting."""
    terms: list[str] = []
    seen: set[str] = set()
    word_budget = 350  # stay well under Deepgram Flux's 500-token keyterm ceiling

    def _add(raw_term: str) -> None:
        nonlocal word_budget
        term = raw_term.strip(".,:;!?()[]{}\"' ")
        if not term or len(term) > 40 or len(terms) >= 80:
            return
        words = len(term.split())
        if words > word_budget:
            return
        key = term.lower()
        if key in _KEYTERM_STOPWORDS or key in seen:
            return
        seen.add(key)
        terms.append(term)
        word_budget -= words

    direct_terms = [
        interview.jobTitle,
        interview.company,
        *interview.keyterms,
        *interview.focusAreas,
        *(q.topic for q in interview.questions),
    ]
    for direct in direct_terms:
        if len(direct.strip()) <= 40:
            _add(direct)

    text_sources = [
        interview.interviewerBrief,
        *interview.focusAreas,
        *(q.question for q in interview.questions),
        *(fu for q in interview.questions for fu in q.followUps),
        *(ec for q in interview.questions for ec in q.evaluationCriteria),
    ]
    for text in text_sources:
        for match in _tech_tokens(text):
            for part in match.split("/"):
                _add(part)

    for generic in _GENERIC_INTERVIEW_KEYTERMS:
        _add(generic)

    return terms


def prewarm(proc: JobProcess) -> None:
    # Load the VAD once per worker process, not per call.
    proc.userdata["vad"] = build_vad()
    proc.userdata["nc"] = build_noise_cancellation(settings)


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
    nc = ctx.proc.userdata["nc"]

    stt_adapter = build_stt(settings, vad)

    @stt_adapter.on("stt_availability_changed")
    def _on_stt_availability(ev: stt.AvailabilityChangedEvent) -> None:
        logger.warning("STT availability changed: %s available=%s", ev.stt.label, ev.available)

    session = AgentSession[InterviewState](
        stt=stt_adapter,
        llm=build_llm(settings),
        tts=build_tts(settings),
        vad=vad,
        userdata=state,
        turn_handling={
            # Delegate end-of-turn detection to Deepgram Flux's native conversational EOT model.
            "turn_detection": "stt",
            # Small buffer on top of Flux's EndOfTurn so late finals don't split a turn,
            # without adding unnecessary latency to Flux's ~260ms turn detection.
            "endpointing": {"mode": "fixed", "min_delay": 0.25},
            # Responsive VAD-based barge-in: 250ms speech + >=1 word interrupts
            # immediately without adaptive backchannel suppression blocking valid
            # interruptions or speech right as the agent finishes.
            "interruption": {
                "mode": "vad",
                "min_duration": 0.25,
                "min_words": 1,
                # If an "interruption" produces no words within 1.5s (noise, echo),
                # treat it as false and let the agent finish its sentence.
                "false_interruption_timeout": 1.5,
                "resume_false_interruption": True,
            },
            # Wait for complete turns so thinking pauses don't burn free-tier LLM quota.
            "preemptive_generation": {"enabled": False},
        },
        stt_context_options={
            "keyterms": _session_keyterms(interview),
            "forward_chat_context": True,
        },
        # Ignore echo during the first 0.5s of the greeting while browser AEC converges.
        aec_warmup_duration=0.5,
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

    @session.on("user_input_transcribed")
    def _on_user_transcribed(ev: UserInputTranscribedEvent) -> None:
        logger.debug("STT %s: %r", "final" if ev.is_final else "interim", ev.transcript)

    @session.on("error")
    def _on_session_error(ev: ErrorEvent) -> None:
        logger.error("session error from %s: %s", type(ev.source).__name__, ev.error)

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
            # Match 16kHz voice rate; Krisp (see NOISE_CANCELLATION) cleans the audio
            # before VAD/STT. Browser already runs AGC, so keep server AGC off.
            audio_input=room_io.AudioInputOptions(
                sample_rate=DEEPGRAM_STT_SAMPLE_RATE,
                noise_cancellation=nc,
                auto_gain_control=False,
            ),
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
