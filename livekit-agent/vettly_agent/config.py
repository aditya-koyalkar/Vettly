from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Worker configuration. LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET are
    read directly by the LiveKit SDK (they also authorise LiveKit Inference)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    agent_name: str = "vettly-interviewer"

    # Vettly API (internal routes). Optional at import time so `download-files`
    # can run during Docker builds without secrets; required at worker start.
    api_service_url: str = "http://localhost:3000"
    api_service_key: str = ""

    # Tier 1 (STT & TTS primary): Direct Deepgram API
    deepgram_api_key: str = ""
    deepgram_stt_model: str = "flux-general-multi"
    deepgram_stt_language: str = "en-IN"
    deepgram_tts_model: str = "aura-2-asteria-en"
    # Flux turn-detection tuning (used by direct STTv2 and LiveKit Inference Flux fallback).
    # 0.75 balances soft turn endings with thinking pauses; 5000ms caps long silences.
    deepgram_flux_eot_threshold: float = 0.75
    deepgram_flux_eager_eot_threshold: float = 0.5
    deepgram_flux_eot_timeout_ms: int = 5000
    # Silence (ms) before Deepgram Nova-3 finalizes a segment (unused by Flux).
    deepgram_endpointing_ms: int = 500

    # Server-side Krisp filter applied before VAD/STT. "nc" (noise only) is the safe
    # default for laptop/external mics; "bvc" also strips background voices but can
    # eat soft or distant speech; "off" sends raw browser audio.
    noise_cancellation: Literal["nc", "bvc", "off"] = "nc"

    # OpenRouter (LLM primary + secondary key rotation)
    openrouter_api_key: str = ""
    openrouter_api_key_secondary: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openrouter_llm_model: str = "nvidia/nemotron-3.5-lightning:free"

    # LiveKit Inference (STT/TTS fallbacks after Direct Deepgram; LLM fallback after OpenRouter)
    livekit_stt_model: str = "deepgram/flux-general-multi"
    livekit_stt_language: str = "en"
    livekit_stt_fallback_model: str = "deepgram/nova-3"
    livekit_llm_model: str = "google/gemma-4-31b-it"
    # "model" or "model:voice"
    livekit_tts_model: str = "fishaudio/s2.1-pro-free"
    livekit_tts_fallback_model: str = "deepgram/aura-2:athena"
    livekit_tts_fallback_model_2: str = "cartesia/sonic-3:9626c31c-bec5-4cca-baa8-f8ba9e84c8bc"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
