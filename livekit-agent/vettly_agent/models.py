"""Speech and language model chains.

Every modality degrades across three tiers so a single exhausted free quota
never ends an interview:

    STT: LiveKit Inference (Deepgram) -> LiveKit Inference (AssemblyAI) -> Groq Whisper
    LLM: LiveKit Inference           -> Gemini (free tier)              -> Groq (two models)
    TTS: LiveKit Inference (Cartesia) -> LiveKit Inference (Deepgram)   -> Groq Orpheus
"""

from __future__ import annotations

import logging

from livekit.agents import inference, llm, stt, tts, vad
from livekit.plugins import google, groq

from .config import Settings

logger = logging.getLogger("vettly.models")


def _split_model_voice(spec: str) -> tuple[str, str | None]:
    model, _, voice = spec.partition(":")
    return model, voice or None


def build_vad() -> vad.VAD:
    # Slightly longer silence than default: candidates pause to think mid-answer.
    return inference.VAD(min_silence_duration=0.4, activation_threshold=0.5)


def build_stt(settings: Settings, vad_model: vad.VAD) -> stt.STT:
    chain: list[stt.STT] = [
        inference.STT(settings.livekit_stt_model, language="en"),
        inference.STT(settings.livekit_stt_fallback_model, language="en"),
    ]
    if settings.groq_api_key:
        # Whisper is batch-only; the adapter streams it using VAD segmentation.
        chain.append(groq.STT(model=settings.groq_stt_model, api_key=settings.groq_api_key, language="en"))
    return stt.FallbackAdapter(chain, vad=vad_model)


def build_llm(settings: Settings) -> llm.LLM:
    chain: list[llm.LLM] = [inference.LLM(settings.livekit_llm_model)]
    if settings.gemini_api_key:
        chain.append(google.LLM(model=settings.gemini_llm_model, api_key=settings.gemini_api_key))
    if settings.groq_api_key:
        chain.append(groq.LLM(model=settings.groq_llm_model, api_key=settings.groq_api_key))
        chain.append(groq.LLM(model=settings.groq_llm_fallback_model, api_key=settings.groq_api_key))
    # Voice latency budget: give up on a provider quickly and move on.
    return llm.FallbackAdapter(chain, attempt_timeout=6.0, max_retry_per_llm=0)


def build_tts(settings: Settings) -> tts.TTS:
    chain: list[tts.TTS] = []
    for spec in (settings.livekit_tts_model, settings.livekit_tts_fallback_model):
        model, voice = _split_model_voice(spec)
        chain.append(inference.TTS(model, voice=voice) if voice else inference.TTS(model))
    if settings.groq_api_key:
        chain.append(
            groq.TTS(model=settings.groq_tts_model, voice=settings.groq_tts_voice, api_key=settings.groq_api_key)
        )
    return tts.FallbackAdapter(chain, max_retry_per_tts=1)
