"""Speech and language model chains with ordered multi-provider fallbacks.

    STT: LiveKit Inference (assemblyai/assemblyai-stt-3-7-realtime-agent)
         -> Direct Deepgram (nova-3 via STT, or flux-* via STTv2)
         -> LiveKit Inference (deepgram/nova-3)
    LLM: OpenRouter primary key (nemotron-3.5-lightning:free)
         -> OpenRouter secondary key (nemotron-3.5-lightning:free)
         -> LiveKit Inference (google/gemma-4-31b-it)
    TTS: Direct Deepgram (aura-2-asteria-en)
         -> LiveKit Inference (fishaudio/s2.1-pro-free -> deepgram/aura-2 -> cartesia/sonic-3)
"""

from __future__ import annotations

from livekit import rtc
from livekit.agents import NOT_GIVEN, inference, llm, stt, tts, vad
from livekit.plugins import deepgram, noise_cancellation, openai

from .config import Settings


def _split_model_voice(spec: str) -> tuple[str, str | None]:
    model, _, voice = spec.partition(":")
    return model, voice or None


# Standard voice/VAD sample rate expected by Silero VAD and Deepgram Nova-3/Flux.
DEEPGRAM_STT_SAMPLE_RATE = 16000


def build_noise_cancellation(settings: Settings) -> rtc.NoiseCancellationOptions | None:
    """Server-side Krisp filter applied to the candidate's track before VAD/STT.

    NC (noise only) is the default: BVC is tuned for close-talking headsets and
    attenuates soft, distant, or laptop-mic speech, which shows up as dropped words.
    """
    if settings.noise_cancellation == "bvc":
        return noise_cancellation.BVC()
    if settings.noise_cancellation == "nc":
        return noise_cancellation.NC()
    return None


def build_vad() -> vad.VAD:
    # 0.5 activation + 100ms minimum speech keeps clicks, breaths and keyboard noise from
    # registering as speech (and from interrupting the agent). 0.45s silence ends a VAD
    # segment; the turn detector + endpointing delay decide whether the turn is over.
    return inference.VAD(
        min_speech_duration=0.1,
        min_silence_duration=0.45,
        prefix_padding_duration=0.5,
        activation_threshold=0.5,
    )


def build_stt(settings: Settings, vad_model: vad.VAD) -> stt.STT:
    chain: list[stt.STT] = []

    if settings.livekit_stt_model.strip():
        extra_kwargs = (
            {"format_turns": True} if settings.livekit_stt_model.startswith("assemblyai/") else NOT_GIVEN
        )
        chain.append(
            inference.STT(
                settings.livekit_stt_model,
                language=settings.livekit_stt_language,
                extra_kwargs=extra_kwargs,
            )
        )

    if settings.deepgram_api_key.strip():
        if settings.deepgram_stt_model.startswith("flux"):
            chain.append(
                deepgram.STTv2(
                    model=settings.deepgram_stt_model,
                    sample_rate=DEEPGRAM_STT_SAMPLE_RATE,
                    api_key=settings.deepgram_api_key,
                )
            )
        else:
            chain.append(
                deepgram.STT(
                    model=settings.deepgram_stt_model,
                    sample_rate=DEEPGRAM_STT_SAMPLE_RATE,
                    language=settings.deepgram_stt_language,
                    api_key=settings.deepgram_api_key,
                    endpointing_ms=settings.deepgram_endpointing_ms,
                    utterance_end_ms=1200,
                    interim_results=True,
                    # smart_format gives readable numbers/emails/acronyms in the saved
                    # transcript; no_delay stops it holding finals back for formatting.
                    smart_format=True,
                    no_delay=True,
                    punctuate=True,
                    # Fillers ("um", "uh") help the turn detector spot unfinished thoughts.
                    filler_words=True,
                )
            )

    if settings.livekit_stt_fallback_model.strip():
        chain.append(
            inference.STT(
                settings.livekit_stt_fallback_model,
                language=settings.deepgram_stt_language,
            )
        )

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
