# Vettly — AI Voice Mock Interview Platform

Vettly parses a candidate's resume and target job description, grounds an interview plan against both documents, conducts a real-time voice interview over WebRTC, and evaluates the transcript with a panel of LLM agents.

---

## Table of Contents

- [Architecture](#architecture)
- [Document Ingestion & Hybrid Retrieval](#document-ingestion--hybrid-retrieval)
- [Pre-Call & Post-Call Agent Workflows](#pre-call--post-call-agent-workflows)
- [Real-Time Voice Pipeline](#real-time-voice-pipeline)
- [Structured Outputs & Prompt Safety](#structured-outputs--prompt-safety)
- [Model Routing & Fallbacks](#model-routing--fallbacks)
- [Background Queues & Session Lifecycle](#background-queues--session-lifecycle)
- [Data Model](#data-model)
- [Authentication & Security](#authentication--security)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Running Locally](#running-locally)
- [Verification & Linting](#verification--linting)

---

## Architecture

```text
┌────────────────────────┐          REST + JWT (Bearer)          ┌──────────────────────────────────────────┐
│   web (React + Vite)   │ ────────────────────────────────────▶ │            api (NestJS + TS)             │
│   LiveKit Components   │ ◀───────── Room JWT + Dispatch ────── │                                          │
└────────────────────────┘                                       │  • Auth / Documents / Sessions REST API  │
            │                                                    │  • Internal Runtime API (x-service-key)  │
            │ WebRTC Audio + Participant Attributes              │  • LangGraph Prep & Analysis Workflows   │
            ▼                                                    │  • BullMQ Workers (ingest, prep, analyze)│
┌────────────────────────┐                                       └────────────┬────────────────┬────────────┘
│     LiveKit Server     │                                                    │                │
│  (Cloud / Inference)   │                                                    ▼                ▼
└────────────────────────┘                                         ┌──────────────────┐  ┌─────────┐
            ▲                                                      │    PostgreSQL    │  │  Redis  │
            │ Worker Dispatch ({ sessionId })                      │  + pgvector HNSW │  │ BullMQ  │
            ▼                                                      │  + GIN FTS index │  │ + Auth  │
┌────────────────────────┐   Internal HTTP (x-service-key)       └──────────────────┘  └─────────┘
│ livekit-agent (Python) │ ───────────────────────────────────────────────────▲
│ Greeter→Interviewer→   │   GET  /context  (start clock, fetch brief/plan)
│ Closer + Transcript    │   POST /search   (live hybrid RAG lookup)
│                        │   POST /notes    (silent observation + 1–5 rating)
│                        │   POST /complete (flush transcript → enqueue analysis)
└────────────────────────┘
```

---

## Document Ingestion & Hybrid Retrieval

When a resume or job description is uploaded (PDF, DOCX, TXT, Markdown, or raw pasted text):

* **Extraction & normalization**: Text is extracted from PDFs (`unpdf` with merged pages), DOCX (`mammoth`), or plain UTF-8 files, collapsing formatting noise while preserving paragraph boundaries. Inputs under 50 extracted characters (such as scanned, un-OCR'd PDFs) are rejected.
* **Section-aware chunking**: Documents are split along detected headings (Markdown headers, uppercase headings, or colon-terminated section labels) so chunks never cross section boundaries. Each chunk is prefixed with its section name, capped at `1,200` characters, split on sentence/line boundaries if oversized, and carried forward with a `150`-character word-boundary overlap.
* **Concurrent indexing & profiling**: On ingest, the worker runs two tasks in parallel—embedding/indexing chunks and extracting a structured JSON profile (`ResumeProfile` or `JobProfile`) using an LLM at temperature `0`.
* **Embeddings & dual indexes**: Chunks are embedded via OpenRouter (`nvidia/nemotron-3.5-embed-8b:free`, `768` dimensions). PostgreSQL stores both a `pgvector` HNSW cosine index (`vector_cosine_ops`) and a GIN full-text index (`to_tsvector('english', content)`).
* **Hybrid search with Reciprocal Rank Fusion (RRF)**: Search queries pull up to `20` candidates from the dense vector leg (`<=>`) and `20` from the lexical full-text leg (`ts_rank_cd`). Because `websearch_to_tsquery` ANDs every term and misses natural-language queries against terse bullets, the lexical leg builds an OR-joined `tsquery`. Results are merged using `1 / (60 + dense_rank) + 1 / (60 + lexical_rank)`. If embedding generation fails, search automatically degrades to lexical-only.

---

## Pre-Call & Post-Call Agent Workflows

Orchestration is built on LangGraph `StateGraph` DAGs with Zod-validated specialist agents.

### Pre-Call Preparation

```text
START ──(Send × N requirements)──▶ retrieveEvidence (parallel RAG)
                                          │ (evidence reducer)
                                          ▼
                                     fitAnalyst ──▶ interviewPlanner ──▶ END
```

1. **Parallel evidence retrieval**: Extracts up to 8 must-have skills, 3 responsibilities, and 3 competencies from the job profile and fans out parallel RAG queries (`Send`) against the candidate's resume chunks (`limit: 2` per requirement).
2. **Fit analysis**: Compares the candidate profile, job profile, and retrieved resume excerpts to produce a `0–100` `matchScore`, evidence-backed strengths, severity-ranked gaps (`low` | `medium` | `high`) with prep advice, and interview `focusAreas`. Requirements without supporting excerpts are flagged as gaps.
3. **Interview planning**: Produces a private `interviewerBrief` and `3–12` spoken-friendly questions (under 40 words, no lists or code blocks) calibrated to interview format (`TECHNICAL`, `BEHAVIORAL`, `SYSTEM_DESIGN`, `MIXED`), difficulty (`EASY`, `MEDIUM`, `HARD`), and duration, each with follow-ups and evaluation criteria.

### Post-Call Evaluation

```text
        ┌─▶ technicalEvaluator ──────┐
START ──┼─▶ communicationEvaluator ──┼─▶ synthesizer ──▶ END
        └─▶ questionReviewer ────────┘
```

1. **Parallel evaluation**: Three specialists run concurrently against the timestamped transcript (`[MM:SS] Interviewer/Candidate: ...`, capped at `60,000` characters), the planned questions + criteria, and any live notes logged during the call:
   * **Technical evaluator** (`temp: 0.1`): Scores `technical_depth`, `problem_solving`, and `role_relevance` (`0–10`) with transcript citations.
   * **Communication coach** (`temp: 0.1`): Scores `clarity`, `structure` (STAR), `conciseness`, and `confidence` (`0–10`), ignoring minor speech-to-text artifacts.
   * **Question reviewer** (`temp: 0.2`): Summarizes each asked question's answer, assigns a `0–10` score, writes specific feedback, and outlines a concrete `strongerAnswer` (skipping unasked questions and tagging unplanned ones as `"extra"`).
2. **Report synthesis** (`temp: 0.3`): Combines all evaluator outputs with pre-interview fit data into an `overallScore` (`0–100`), hiring `verdict` (`strong_hire` through `no_hire`), candidate-facing summary, strengths, and up to 5 impact-ordered practice steps.

---

## Real-Time Voice Pipeline

Live interviews run inside a Python `livekit-agents` worker connected to LiveKit over WebRTC:

* **Zero-signaling dispatch**: Joining a session generates a LiveKit participant JWT containing a `RoomAgentDispatch` payload (`agentName` + `{ sessionId }`), so LiveKit automatically dispatches the worker when the browser connects.
* **Turn-taking & audio handling**:
  * A prewarmed VAD model (`min_silence_duration=0.4`, `activation_threshold=0.5`) tolerates natural thinking pauses.
  * LiveKit's semantic `TurnDetector()` paired with dynamic endpointing (`0.6s–4.0s`) distinguishes mid-thought pauses from finished answers.
  * Adaptive barge-in (`min_duration=0.6s`, `false_interruption_timeout=1.5s`) prevents short backchannels (`"mm-hmm"`) from cutting off the interviewer.
  * Uses LiveKit `BVC` noise cancellation and a `25.0s` `user_away_timeout` check-in if the candidate goes silent.
* **Three-stage agent handoffs**:
  * **Greeter**: Welcomes the candidate, explains the format, confirms readiness, starts the interview clock, and hands off.
  * **Interviewer**: Walks through the planned questions one at a time using four function tools: `next_question` (enforces a `1.5`-minute wrap-up threshold), `search_candidate_background` (live hybrid RAG against resume/JD), `record_observation` (silently persists `1–5` rated notes to Postgres), and `wrap_up`.
  * **Closer**: Thanks the candidate, fields one closing question, says goodbye, waits for audio playout to finish (`wait_for_playout()`), and deletes the LiveKit room.
  * Across handoffs, `carried_context()` copies the conversation history while stripping prior system instructions, tool calls, and handoff metadata so each stage keeps context without persona leakage.
* **Time enforcement & telemetry**: A background `clock_watchdog` checks remaining time every `5s` and forces a handoff to the Closer if the duration expires. Live progress (`phase`, `question_index`, `question_total`, `topic`) is synced to the browser via LiveKit participant attributes.
* **Transcript capture**: Conversation events (`AGENT` and `CANDIDATE` turns with relative `offsetSec`) are buffered throughout the call and posted idempotently on room shutdown to trigger post-call analysis.

---

## Structured Outputs & Prompt Safety

* **Schema-enforced generation**: Every non-realtime LLM call uses structured tool-calling (`withStructuredOutput`) followed by strict `zod` `.parse()` validation so malformed provider responses fail immediately and trigger fallback routing.
* **Prompt-injection isolation**: Untrusted user inputs (resumes, job descriptions, transcripts, live notes) are wrapped in XML-style blocks (with closing-tag collisions stripped) alongside system instructions (`DATA_GUARD`) directing models never to execute instructions found inside tagged data. Voice prompts apply the same rule to spoken candidate input.

---

## Model Routing & Fallbacks

Configured for zero-cost operation across free-tier credits and `:free` endpoints, with automatic key rotation (`OPENROUTER_API_KEY` ↔ `OPENROUTER_API_KEY_SECONDARY`) and ordered fallbacks:

| Modality | Tier 1 (Primary) | Tier 2 (Fallback) | Tier 3+ (Fallbacks) | Timeout / Retry |
|---|---|---|---|---|
| **Prep & Analysis LLM** | `nvidia/nemotron-3.5-lightning:free` (OpenRouter keys 1 ↔ 2) | `nvidia/nemotron-3-ultra-550b-a55b:free` (OpenRouter keys 1 ↔ 2) | `google/gemma-4-31b-it:free` (OpenRouter keys 1 ↔ 2) | `60s` per slot |
| **Embeddings** | `nvidia/nemotron-3.5-embed-8b:free` (OpenRouter key 1 ↔ 2, `768`-d) | Lexical-only Postgres FTS (`null` fallback) | — | — |
| **Voice LLM** | `nvidia/nemotron-3.5-lightning:free` (OpenRouter key 1) | `nvidia/nemotron-3.5-lightning:free` (OpenRouter key 2) | `google/gemma-4-31b-it` (LiveKit Inference) | `6s` attempt timeout |
| **Voice STT** | `nova-3` (`en-IN`, Direct Deepgram) | `deepgram/nova-3` (`en-IN`, LiveKit Inference) | `assemblyai/assemblyai-stt-3-7-realtime-agent` (LiveKit Inference) | Fallback adapter + VAD |
| **Voice TTS** | `aura-2-asteria-en` (Direct Deepgram) | `fishaudio/s2.1-pro-free` (LiveKit Inference) | `deepgram/aura-2` (`athena`) → `cartesia/sonic-3` (LiveKit Inference) | 1 retry per model |

Every generated report records which model slot produced each evaluator and synthesizer output.

---

## Background Queues & Session Lifecycle

Three Redis-backed BullMQ workers run in-process inside the NestJS API (`attempts: 3`, `5s` exponential backoff):

1. **Document Ingest (`concurrency: 4`)**: `PROCESSING` → `READY` | `FAILED`.
2. **Session Prep (`concurrency: 2`)**: `PREPARING` → `READY` | `FAILED`. If the linked resume or JD is still `PROCESSING`, the job delays itself by `3s` (`DelayedError`) instead of burning retry attempts.
3. **Session Analysis (`concurrency: 2`)**: `ANALYZING` → `COMPLETED` | `FAILED`.
   * **Silent-call handling**: If a call closes with zero `CANDIDATE` transcript turns, the session resets to `READY` so the user can restart instead of failing analysis.
   * **Stage-aware retries**: Retrying a `FAILED` session checks whether `TranscriptTurn` rows exist—if so, it re-enqueues only analysis while preserving the saved transcript; otherwise it re-runs prep.

---

## Data Model

* **`User`**: Account credentials and ownership of documents and sessions.
* **`Document`** (`RESUME` | `JOB_DESCRIPTION`): `rawText`, processing `status`, extracted `profile` JSON, and **`DocumentChunk[]`** (`chunkIndex`, `section`, `content`, `vector(768)` embedding).
* **`InterviewSession`**: Tracks status (`PREPARING` → `READY` → `IN_PROGRESS` → `ANALYZING` → `COMPLETED` | `FAILED`), `fitAnalysis` JSON, `plan` JSON, `roomName`, and timestamps.
  * **`TranscriptTurn[]`**: Ordered `AGENT`/`CANDIDATE` turns with `agentName` and `offsetSec`.
  * **`InterviewNote[]`**: In-call observations (`questionId`, `topic`, `observation`, `rating`).
  * **`InterviewReport`**: `overallScore`, `verdict`, `summary`, `dimensions` JSON, `questionReviews` JSON, `strengths`, `improvements`, and `model` trace.

---

## Authentication & Security

* **JWT + Redis session state**: 15-minute Bearer access tokens (enforced globally unless `@Public()`) paired with 7-day opaque refresh tokens stored in Redis. Refreshing atomically rotates tokens (`MULTI`/`DEL`/`SREM`); signing out blacklists the access token `jti` for its remaining TTL; revoking all clears the user's active session set.
* **Internal worker authentication**: Internal endpoints used by the voice worker bypass JWT auth and rate limits, verifying a shared `x-service-key` header in constant time (`crypto.timingSafeEqual`).
* **Input & rate limits**: Boot-time Zod validation of all environment variables, global Zod request validation (`StandardSchemaValidationPipe`), global rate limiting (`120 req/min`), and stricter auth throttling (`10 req/min` on signup/signin).

---

## Tech Stack

* **API**: NestJS 12, TypeScript 6, Prisma 6, PostgreSQL 16 + `pgvector`, Redis 7 + BullMQ 6, LangGraph, LangChain (`@langchain/openai` via OpenRouter), LiveKit Server SDK, Zod 4, `unpdf`, `mammoth`
* **Voice Worker**: Python ≥ 3.13 (`uv`), `livekit-agents[openai]` (OpenRouter LLM/STT/TTS), `livekit-plugins-noise-cancellation`, `aiohttp`, `pydantic-settings`
* **Web UI**: React 19, TypeScript, Vite 8, Tailwind CSS 4, TanStack Query 5, React Router 8, LiveKit Components React

---

## Project Structure

```text
├── compose.yml        # Postgres (pgvector), Redis, NestJS API, and LiveKit worker
├── api/               # NestJS API, Prisma schema/migrations, LangGraph & BullMQ workers
├── livekit-agent/     # Python LiveKit voice worker (Greeter, Interviewer, Closer)
└── web/               # React SPA (auth, documents, session setup, live call room, report UI)
```

---

## Running Locally

### Prerequisites
* Node.js 22+, Python 3.13+ with [`uv`](https://docs.astral.sh/uv/), and Docker
* API keys for **LiveKit Cloud** and **OpenRouter**

### Option 1: Hybrid local dev (recommended)

```bash
# 1. Configure environment files (API_SERVICE_KEY must match in both)
cp api/.env.example api/.env
cp livekit-agent/.env.example livekit-agent/.env

# 2. Start Postgres (pgvector) and Redis
docker compose up -d postgres redis

# 3. Start NestJS API (in api/.env set DATABASE_URL host to localhost and REDIS_URL=redis://localhost:6379)
cd api
npm install
npx prisma migrate deploy
npm run start:dev

# 4. Start LiveKit Python voice worker (new terminal)
cd livekit-agent
uv sync
uv run agent.py download-files
uv run agent.py dev

# 5. Start React frontend (new terminal, proxies /api -> http://localhost:3000)
cd web
npm install
npm run dev
```

Open `http://localhost:5173`.

### Option 2: Docker Compose for backend + worker

```bash
cp api/.env.example api/.env
cp livekit-agent/.env.example livekit-agent/.env   # set API_SERVICE_KEY to match api/.env
docker compose up --build

# Run frontend locally
cd web && npm install && npm run dev
```

---

## Verification & Linting

```bash
# API
cd api && npm test && npm run lint && npm run build

# LiveKit agent
cd livekit-agent && uv run ruff check . && uv run pyright

# Web
cd web && npm run lint && npm run build
```
