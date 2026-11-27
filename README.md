# Vettly — AI Voice Mock Interview Platform

Vettly parses a candidate's resume and target job description, grounds a tailored interview plan against both documents, conducts a low-latency WebRTC voice interview with a multi-stage AI interviewer, and evaluates the call with a parallel panel of specialist LLM agents.

---

## What Makes Vettly Stand Out

- **End-to-End STT & Audio Pipeline Tuning**: Eliminates double audio-processing, preserves high-frequency consonants (`AudioPresets.musicHighQuality`, `dtx: false`), tunes Silero VAD (`activation_threshold=0.3`) for natural speaking volume, delegates turn detection to **Deepgram Flux (`flux-general-en`)**, and boosts recognition with up to **80 dynamic keyterms** extracted from the candidate's resume, job description, and interview plan.
- **Resilient Multi-Provider Fallbacks**: Every modality (LLM, STT, TTS, Embeddings) has an ordered fallback chain across Direct Deepgram, OpenRouter (dual-key rotation), and LiveKit Inference, with sticky failover on timeouts/rate limits.
- **Dual Multi-Agent Architecture**:
  - **Pre-Call & Post-Call LangGraph DAGs**: Parallel RAG evidence retrieval, fit analysis, interview planning, and a 3-specialist parallel evaluation panel + report synthesizer.
  - **Real-Time 3-Stage Voice Handoffs**: `GreeterAgent` → `InterviewerAgent` → `CloserAgent` inside `livekit-agents`, carrying clean conversation history across handoffs while enforcing time limits and logging silent structured observations.
- **Hybrid RAG with Graceful Degradation**: Section-aware chunking + `pgvector` HNSW dense search + PostgreSQL GIN full-text search merged via Reciprocal Rank Fusion (RRF), falling back to lexical-only search if embeddings are unavailable.

---

## Architecture

```text
┌────────────────────────┐          REST + JWT (Bearer)          ┌──────────────────────────────────────────┐
│   web (React + Vite)   │ ────────────────────────────────────▶ │            api (NestJS + TS)             │
│  LiveKit + Mic Check   │ ◀───────── Room JWT + Dispatch ────── │                                          │
└────────────────────────┘                                       │  • Auth / Documents / Sessions REST API  │
            │                                                    │  • Internal Runtime API (x-service-key)  │
            │ WebRTC Audio (Opus HQ, DTX off)                    │  • LangGraph Prep & Analysis Workflows   │
            │ + Live Participant Attributes                      │  • BullMQ Workers (ingest, prep, analyze)│
            ▼                                                    └────────────┬────────────────┬────────────┘
┌────────────────────────┐                                                    │                │
│     LiveKit Server     │                                                    ▼                ▼
│  (Cloud / Inference)   │                                         ┌──────────────────┐  ┌─────────┐
└────────────────────────┘                                         │    PostgreSQL    │  │  Redis  │
            ▲                                                      │  + pgvector HNSW │  │ BullMQ  │
            │ Worker Dispatch ({ sessionId })                      │  + GIN FTS index │  │ + Auth  │
            ▼                                                      └──────────────────┘  └─────────┘
┌────────────────────────┐   Internal HTTP (x-service-key)       └──────────────────┘  └─────────┘
│ livekit-agent (Python) │ ───────────────────────────────────────────────────▲
│ Deepgram Flux + VAD    │   GET  /context  (start clock, plan, JD/resume keyterms)
│ Greeter→Interviewer→   │   POST /search   (live hybrid RAG lookup)
│ Closer + Transcript    │   POST /notes    (silent observation + 1–5 rating)
│                        │   POST /complete (flush transcript → enqueue analysis)
└────────────────────────┘
```

---

## Real-Time Voice Pipeline Optimizations

### 1. STT & Audio Capture Pipeline
Voice interviews fail most often before STT even sees the audio (clipped consonants, double noise-cancellation, or overly strict VAD). Vettly optimizes every stage:

- **Browser Capture (`web/src/pages/live-interview.tsx`)**:
  - **Pre-join Mic Check**: `PreJoin` lets candidates select their microphone and verify a live `AudioContext` input meter before joining, releasing the preview stream cleanly before LiveKit acquires the track.
  - **High-Bitrate Opus**: Publishes with `AudioPresets.musicHighQuality`, `dtx: false` (never gates soft speech as silence), and `red: true` (redundant packet recovery).
  - **Single-Stage WebRTC Processing**: `echoCancellation: true`, `noiseSuppression: true`, `autoGainControl: true` run once in the browser; server-side Krisp (`NOISE_CANCELLATION=off`) and server-side `auto_gain_control=False` are disabled to avoid double-processing distortion.
- **Silero VAD Tuning (`livekit-agent/vettly_agent/models.py`)**:
  - `activation_threshold=0.3` (down from `0.5` default) and `min_speech_duration=0.05s` pick up normal speaking volume without forcing the candidate to shout.
  - `prefix_padding_duration=0.6s` preserves word-initial consonants; `min_silence_duration=0.35s` keeps segment boundaries crisp.
- **Deepgram Flux + Conversational Turn Detection (`models.py`, `config.py`, `agent.py`)**:
  - **Primary**: Direct Deepgram `STTv2` (`flux-general-en` at `16 kHz`, `mip_opt_out=True`) with **native STT turn detection** (`turn_detection="stt"`).
  - **Interview-Tuned EOT**: `eot_threshold=0.75` (respects brief thinking pauses without dragging), `eager_eot_threshold=0.5`, `eot_timeout_ms=5000` backstop, and `endpointing={"mode": "fixed", "min_delay": 0.25}`.
  - **Responsive Barge-In**: VAD-based interruption (`mode="vad"`, `min_duration=0.25s`, `min_words=1`, `false_interruption_timeout=1.5s`, `resume_false_interruption=True`, `aec_warmup_duration=0.5s`) lets candidates interrupt naturally while recovering from brief echo/noise.
- **Dynamic Keyterm Boosting (`interview-runtime.service.ts` + `agent.py`)**:
  - `GET /api/internal/sessions/:id/context` extracts up to 50 domain terms from the JD (`mustHaveSkills`, `niceToHaveSkills`, `domain`, `competencies`) and resume (`skills`, `projects`, `experiences`).
  - `_session_keyterms` merges those with `jobTitle`, `company`, `focusAreas`, question topics/follow-ups/criteria, technical tokens, and generic engineering terms (capped at **80 terms / 350 words** to stay safely under Deepgram Flux's 500-token limit).
- **STT-Tolerant Prompts (`prompts.py`)**:
  - `VOICE_RULES` instructs all three voice agents to interpret minor live-ASR phonetic slips charitably in context rather than breaking interview flow.

### 2. TTS & Voice LLM Latency
- **Ordered TTS Fallback (`models.py`)**: Direct Deepgram (`aura-2-asteria-en`) → LiveKit Inference (`fishaudio/s2.1-pro-free` → `deepgram/aura-2:athena` → `cartesia/sonic-3`), wrapped in `tts.FallbackAdapter(..., max_retry_per_tts=1)`.
- **Sticky LLM Failover (`models.py`)**: OpenRouter primary key → OpenRouter secondary key → LiveKit Inference (`google/gemma-4-31b-it`) with `attempt_timeout=6.0s`, `max_retry_per_llm=0`, `retry_interval=60.0s`, and `sticky=True` so a rate-limited or slow provider is bypassed for the rest of the call.
- **Quota-Safe Generation**: `preemptive_generation` is disabled so mid-thought pauses don't waste LLM tokens.

### 3. Three-Stage Voice Agent Handoffs
- **`GreeterAgent`**: Welcomes the candidate, explains the format, confirms readiness, starts the interview clock, and hands off.
- **`InterviewerAgent`**: Conducts the interview one question at a time with four function tools:
  - `next_question` (enforces a `1.5`-minute wrap-up threshold)
  - `search_candidate_background` (live hybrid RAG against resume/JD)
  - `record_observation` (silently logs `1–5` rated notes to PostgreSQL)
  - `wrap_up`
- **`CloserAgent`**: Thanks the candidate, fields one closing question, says goodbye, waits for audio playout (`wait_for_playout()`), and closes the room.
- **Clean Context Carryover**: `carried_context()` transfers conversation history across handoffs while stripping prior system instructions, tool calls, and handoff metadata.
- **Watchdog & Telemetry**: A `5s` `clock_watchdog` triggers wrap-up when time expires; live state (`phase`, `question_index`, `question_total`, `topic`) syncs to the UI via LiveKit participant attributes; `user_away_timeout=35.0s` triggers a gentle check-in; `TranscriptRecorder` posts turns idempotently on shutdown.

---

## Multi-Agent Prep & Evaluation (LangGraph)

Orchestrated via LangGraph `StateGraph` DAGs with Zod-validated structured outputs and XML-tagged prompt-injection isolation (`DATA_GUARD`):

### Pre-Call Preparation
```text
START ──(Send × N requirements)──▶ retrieveEvidence (parallel RAG)
                                          │ (evidence reducer)
                                          ▼
                                     fitAnalyst ──▶ interviewPlanner ──▶ END
```
1. **Parallel Evidence Retrieval**: Fans out concurrent RAG queries (`Send`) for up to 8 must-have skills, 3 responsibilities, and 3 competencies against the resume.
2. **Fit Analyst**: Produces a `0–100` `matchScore`, evidence-backed strengths, severity-ranked gaps (`low` | `medium` | `high`) with prep advice, and `focusAreas`.
3. **Interview Planner**: Generates a private `interviewerBrief` and `3–12` spoken-friendly questions calibrated to format, difficulty, and duration.

### Post-Call Evaluation
```text
        ┌─▶ technicalEvaluator ──────┐
START ──┼─▶ communicationEvaluator ──┼─▶ synthesizer ──▶ END
        └─▶ questionReviewer ────────┘
```
1. **Parallel Specialists**: `technicalEvaluator`, `communicationEvaluator` (instructed to ignore minor ASR artifacts), and `questionReviewer` score the timestamped transcript + live interviewer notes concurrently.
2. **Report Synthesizer**: Produces the final `0–100` `overallScore`, hiring `verdict` (`strong_hire` through `no_hire`), summary, strengths, and up to 5 prioritized practice steps, recording model provenance per stage.

---

## Document Ingestion & Hybrid Retrieval

1. **Extraction**: `unpdf` (PDF), `mammoth` (DOCX), or UTF-8 text; rejects inputs under 50 extracted characters.
2. **Section-Aware Chunking**: Splits on detected headings, prefixes chunks with section labels, caps at `1,200` chars with `150`-char word-boundary overlap.
3. **Concurrent Indexing & Profiling**: Embeds chunks (`nvidia/nemotron-3.5-embed-8b:free`, `768`-d) into `pgvector` HNSW + PostgreSQL GIN FTS while extracting `ResumeProfile` / `JobProfile` JSON in parallel.
4. **Hybrid RRF Search**: Merges top-20 dense cosine results and top-20 OR-joined lexical FTS results via `1 / (60 + dense_rank) + 1 / (60 + lexical_rank)`, automatically degrading to lexical-only if embeddings fail.

---

## Model Routing & Fallbacks

| Modality | Tier 1 (Primary) | Tier 2 (Fallback) | Tier 3+ (Fallbacks) | Resilience |
|---|---|---|---|---|
| **Prep & Analysis LLM** | `nvidia/nemotron-3.5-lightning:free` (OpenRouter keys 1 ↔ 2) | `nvidia/nemotron-3.5-ultra-550b-a55b:free` | `google/gemma-4-31b-it:free` | `60s` timeout, Zod-validated |
| **Embeddings** | `nvidia/nemotron-3.5-embed-8b:free` (OpenRouter keys 1 ↔ 2, `768`-d) | Lexical-only Postgres FTS | — | Automatic degradation |
| **Voice LLM** | `nvidia/nemotron-3.5-lightning:free` (OpenRouter key 1) | `nvidia/nemotron-3.5-lightning:free` (OpenRouter key 2) | `google/gemma-4-31b-it` (LiveKit Inference) | `6s` timeout, `sticky=True` |
| **Voice STT** | `flux-general-en` (Direct Deepgram `STTv2`) | `deepgram/flux-general-en` (LiveKit Inference) | `deepgram/nova-3` (`en-IN`, LiveKit Inference) | `FallbackAdapter` + Silero VAD (`0.3`) |
| **Voice TTS** | `aura-2-asteria-en` (Direct Deepgram) | `fishaudio/s2.1-pro-free` (LiveKit Inference) | `deepgram/aura-2:athena` → `cartesia/sonic-3` | `1` retry per TTS |

---

## Background Queues, Data Model & Security

- **BullMQ Queues (Redis)**: Document ingest (`concurrency: 4`), session prep (`concurrency: 2`, delays `3s` via `DelayedError` if docs are still `PROCESSING`), and post-call analysis (`concurrency: 2`, resets silent zero-candidate calls to `READY`, stage-aware retries).
- **PostgreSQL + `pgvector`**: `User`, `Document` + `DocumentChunk` (`vector(768)`), `InterviewSession`, `TranscriptTurn`, `InterviewNote`, `InterviewReport`.
- **Security**: 15-min JWT access tokens + 7-day rotating Redis refresh tokens (blacklisted on signout), constant-time `x-service-key` guard (`crypto.timingSafeEqual`) for internal worker routes, Zod env/request validation, and route throttling.

---

## Tech Stack & Project Structure

- **API**: NestJS 12, TypeScript, Prisma 6, PostgreSQL 16 + `pgvector`, Redis 7 + BullMQ 6, LangGraph, LangChain, LiveKit Server SDK, Zod 4, `unpdf`, `mammoth`
- **Voice Worker**: Python ≥ 3.13 (`uv`), `livekit-agents[openai,deepgram]~=1.8.13`, `livekit-plugins-noise-cancellation~=0.3.3`, `aiohttp`, `pydantic-settings`
- **Web UI**: React 19, TypeScript, Vite 8, Tailwind CSS 4, TanStack Query 5, React Router, LiveKit Components React

```text
├── compose.yml        # Postgres (pgvector), Redis, NestJS API, and LiveKit worker
├── api/               # NestJS API, Prisma schema/migrations, LangGraph & BullMQ workers
├── livekit-agent/     # Python LiveKit voice worker (Greeter, Interviewer, Closer)
└── web/               # React SPA (auth, documents, session setup, live call room, report UI)
```

---

## Running Locally & Verification

```bash
# 1. Configure env files (API_SERVICE_KEY must match in api/.env and livekit-agent/.env)
cp api/.env.example api/.env
cp livekit-agent/.env.example livekit-agent/.env

# 2. Start Postgres (pgvector) and Redis
docker compose up -d postgres redis

# 3. Start NestJS API
cd api && npm install && npx prisma migrate deploy && npm run start:dev

# 4. Start LiveKit Python voice worker (new terminal)
cd livekit-agent && uv sync && uv run agent.py download-files && uv run agent.py dev

# 5. Start React frontend (new terminal)
cd web && npm install && npm run dev
```

Verification:
```bash
cd api && npm test && npm run lint && npm run build
cd livekit-agent && uv run ruff check . && uv run pyright
cd web && npm run lint && npm run build
```
