"""Speech and language model chains.

STT & TTS use direct Deepgram as primary when DEEPGRAM_API_KEY is set, then
degrade through LiveKit Inference and OpenRouter:

    STT: Deepgram (nova-3) -> LiveKit (deepgram/nova-3 -> assemblyai-stt-3-7)
         -> OpenRouter (whisper-large-v3-turbo -> voxtral-mini-transcribe-3-0 -> mai-transcribe-2)
    LLM: LiveKit (google/gemma-4-31b-it)
         -> OpenRouter (gemini-3.8-flash -> qwen3.8-flash -> gpt-5.6-luna)
    TTS: Deepgram (aura-2-asteria-en) -> LiveKit (deepgram/aura-2 -> cartesia/sonic-3)
         -> OpenRouter (gemini-3.8-flash-lite-tts -> voxtral-mini-tts-3-0 -> kokoro-82m)
"""

from __future__ import annotations

from livekit.agents import inference, llm, stt, tts, vad
from livekit.plugins import deepgram, openai

from .config import Settings


def _split_model_voice(spec: str) -> tuple[str, str | None]:
    model, _, voice = spec.partition(":")
    return model, voice or None


def build_vad() -> vad.VAD:
    # Slightly longer silence than default: candidates pause to think mid-answer.
    return inference.VAD(min_silence_duration=0.4, activation_threshold=0.5)


def build_stt(settings: Settings, vad_model: vad.VAD) -> stt.STT:
    chain: list[stt.STT] = []

    if settings.deepgram_api_key.strip():
        chain.append(
            deepgram.STT(
                model=settings.deepgram_stt_model,
                language=settings.deepgram_stt_language,
                api_key=settings.deepgram_api_key,
            )
        )

    chain.append(inference.STT(settings.livekit_stt_model, language=settings.livekit_stt_language))
    if settings.livekit_stt_fallback_model.strip():
        chain.append(inference.STT(settings.livekit_stt_fallback_model, language="en"))

    if settings.openrouter_api_key.strip():
        for model in (
            settings.openrouter_stt_model,
            settings.openrouter_stt_fallback_1,
            settings.openrouter_stt_fallback_2,
        ):
            if model.strip():
                chain.append(
                    openai.STT(
                        model=model,
                        language="en",
                        api_key=settings.openrouter_api_key,
                        base_url=settings.openrouter_base_url,
                    )
                )

    return stt.FallbackAdapter(chain, vad=vad_model)


def build_llm(settings: Settings) -> llm.LLM:
    chain: list[llm.LLM] = [inference.LLM(settings.livekit_llm_model)]

    if settings.openrouter_api_key.strip():
        for model in (
            settings.openrouter_llm_model,
            settings.openrouter_llm_fallback_1,
            settings.openrouter_llm_fallback_2,
        ):
            if model.strip():
                chain.append(
                    openai.LLM(
                        model=model,
                        api_key=settings.openrouter_api_key,
                        base_url=settings.openrouter_base_url,
                        max_completion_tokens=1024,
                    )
                )

    # Voice latency budget: give up on a provider quickly and move on.
    return llm.FallbackAdapter(chain, attempt_timeout=6.0, max_retry_per_llm=0)


def build_tts(settings: Settings) -> tts.TTS:
    chain: list[tts.TTS] = []

    if settings.deepgram_api_key.strip():
        chain.append(
            deepgram.TTS(
                model=settings.deepgram_tts_model,
                api_key=settings.deepgram_api_key,
            )
        )

    for spec in (settings.livekit_tts_model, settings.livekit_tts_fallback_model):
        if not spec.strip():
            continue
        model, voice = _split_model_voice(spec)
        chain.append(inference.TTS(model, voice=voice) if voice else inference.TTS(model))

    if settings.openrouter_api_key.strip():
        for spec in (
            settings.openrouter_tts_model,
            settings.openrouter_tts_fallback_1,
            settings.openrouter_tts_fallback_2,
        ):
            if not spec.strip():
                continue
            model, voice = _split_model_voice(spec)
            # Raw 24 kHz PCM is supported by all three OpenRouter TTS models.
            chain.append(
                openai.TTS(
                    model=model,
                    voice=voice or "alloy",
                    response_format="pcm",
                    api_key=settings.openrouter_api_key,
                    base_url=settings.openrouter_base_url,
                )
            )

    return tts.FallbackAdapter(chain, max_retry_per_tts=1)
