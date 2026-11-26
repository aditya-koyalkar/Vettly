from functools import lru_cache

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
    deepgram_stt_model: str = "nova-3"
    deepgram_stt_language: str = "en-IN"
    deepgram_tts_model: str = "aura-2-asteria-en"

    # Tier 2 (STT/TTS fallback, LLM primary): LiveKit Inference
    livekit_stt_model: str = "deepgram/nova-3"
    livekit_stt_language: str = "en-IN"
    livekit_stt_fallback_model: str = "assemblyai/assemblyai-stt-3-7-realtime-agent"
    livekit_llm_model: str = "google/gemma-4-31b-it"
    # "model:voice"
    livekit_tts_model: str = "deepgram/aura-2:athena"
    livekit_tts_fallback_model: str = "cartesia/sonic-3:9626c31c-bec5-4cca-baa8-f8ba9e84c8bc"

    # Tier 3: OpenRouter fallbacks
    openrouter_api_key: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api/v1"

    openrouter_llm_model: str = "google/gemini-3.8-flash"
    openrouter_llm_fallback_1: str = "qwen/qwen3.8-flash"
    openrouter_llm_fallback_2: str = "openai/gpt-5.6-luna"

    openrouter_stt_model: str = "openai/whisper-large-v3-turbo"
    openrouter_stt_fallback_1: str = "mistralai/voxtral-mini-transcribe-3-0"
    openrouter_stt_fallback_2: str = "microsoft/mai-transcribe-2"

    # "model:voice"
    openrouter_tts_model: str = "google/gemini-3.8-flash-lite-tts:Kore"
    openrouter_tts_fallback_1: str = "mistralai/voxtral-mini-tts-3-0:en_paul_neutral"
    openrouter_tts_fallback_2: str = "hexgrad/kokoro-82m:af_heart"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
