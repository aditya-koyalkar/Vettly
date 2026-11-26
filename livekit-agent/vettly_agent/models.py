"""Speech and language model chains with ordered multi-provider fallbacks.

    STT: Direct Deepgram (nova-3, en)
         -> LiveKit Inference (deepgram/nova-3 -> assemblyai/assemblyai-stt-3-7-realtime-agent)
    LLM: OpenRouter primary key (nemotron-3.5-lightning:free)
         -> OpenRouter secondary key (nemotron-3.5-lightning:free)
         -> LiveKit Inference (google/gemma-4-31b-it)
    TTS: Direct Deepgram (aura-2-asteria-en)
         -> LiveKit Inference (fishaudio/s2.1-pro-free -> deepgram/aura-2 -> cartesia/sonic-3)
"""

from __future__ import annotations

from livekit.agents import NOT_GIVEN, inference, llm, stt, tts, vad
from livekit.plugins import deepgram, openai

from .config import Settings


def _split_model_voice(spec: str) -> tuple[str, str | None]:
    model, _, voice = spec.partition(":")
    return model, voice or None


def build_vad() -> vad.VAD:
    # Slightly longer silence and firmer threshold so breaths and room noise don't chop turns.
    return inference.VAD(
        min_speech_duration=0.1,
        min_silence_duration=0.55,
        activation_threshold=0.55,
    )


def build_stt(settings: Settings, vad_model: vad.VAD) -> stt.STT:
    chain: list[stt.STT] = []

    if settings.deepgram_api_key.strip():
        chain.append(
            deepgram.STT(
                model=settings.deepgram_stt_model,
                language=settings.deepgram_stt_language,
                api_key=settings.deepgram_api_key,
                interim_results=True,
                # Finalize quickly so remote STT latency fits cleanly inside endpointing.min_delay.
                endpointing_ms=200,
                utterance_end_ms=1000,
                no_delay=True,
                smart_format=False,
                punctuate=True,
                filler_words=True,
            )
        )

    chain.append(inference.STT(settings.livekit_stt_model, language=settings.livekit_stt_language))
    if settings.livekit_stt_fallback_model.strip():
        chain.append(inference.STT(settings.livekit_stt_fallback_model, language="en"))

    return stt.FallbackAdapter(chain, vad=vad_model)


def build_llm(settings: Settings) -> llm.LLM:
    chain: list[llm.LLM] = []

    if settings.openrouter_llm_model.strip():
        extra_body = (
            {"reasoning": {"enabled": False}}
            if "nemotron" in settings.openrouter_llm_model
            else None
        )
        seen_keys: set[str] = set()
        for raw_key in (settings.openrouter_api_key, settings.openrouter_api_key_secondary):
            key = raw_key.strip()
            if not key or key in seen_keys:
                continue
            seen_keys.add(key)
            chain.append(
                openai.LLM(
                    model=settings.openrouter_llm_model,
                    api_key=key,
                    base_url=settings.openrouter_base_url,
                    max_completion_tokens=1024,
                    extra_body=extra_body if extra_body is not None else NOT_GIVEN,
                )
            )

    chain.append(inference.LLM(settings.livekit_llm_model))

    # Give up quickly on timeouts/429s and stick to the working fallback for the call.
    return llm.FallbackAdapter(
        chain,
        attempt_timeout=6.0,
        max_retry_per_llm=0,
        retry_interval=60.0,
        sticky=True,
    )


def build_tts(settings: Settings) -> tts.TTS:
    chain: list[tts.TTS] = []

    if settings.deepgram_api_key.strip():
        chain.append(
            deepgram.TTS(
                model=settings.deepgram_tts_model,
                api_key=settings.deepgram_api_key,
            )
        )

    for spec in (
        settings.livekit_tts_model,
        settings.livekit_tts_fallback_model,
        settings.livekit_tts_fallback_model_2,
    ):
        if not spec.strip():
            continue
        model, voice = _split_model_voice(spec)
        chain.append(inference.TTS(model, voice=voice) if voice else inference.TTS(model))

    return tts.FallbackAdapter(chain, max_retry_per_tts=1)
