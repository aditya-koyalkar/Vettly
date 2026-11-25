from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Worker configuration. LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET are
    read directly by the LiveKit SDK (they also authorise LiveKit Inference)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    agent_name: str = "vettly-interviewer"

    # Vettly API (internal routes)
    api_service_url: str = "http://localhost:3000"
    api_service_key: str

    # Tier 1: LiveKit Inference (free credits on LiveKit Cloud).
    livekit_stt_model: str = "deepgram/nova-3"
    livekit_stt_fallback_model: str = "assemblyai/universal-streaming"
    livekit_llm_model: str = "openai/gpt-4.1-mini"
    # "model:voice"
    livekit_tts_model: str = "cartesia/sonic-3:9626c31c-bec5-4cca-baa8-f8ba9e84c8bc"
    livekit_tts_fallback_model: str = "deepgram/aura-2:athena"

    # Tier 2: Gemini free tier.
    gemini_api_key: str | None = None
    gemini_llm_model: str = "gemini-2.5-flash"

    # Tier 3: Groq free tier.
    groq_api_key: str | None = None
    groq_llm_model: str = "openai/gpt-oss-120b"
    groq_llm_fallback_model: str = "llama-3.3-70b-versatile"
    groq_stt_model: str = "whisper-large-v3-turbo"
    groq_tts_model: str = "canopylabs/orpheus-v1-english"
    groq_tts_voice: str = "hannah"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
