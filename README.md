# Vettly — AI voice mock interviews

Upload a resume and a job description; Vettly builds a tailored interview, an AI voice
interviewer conducts it over WebRTC, and a panel of evaluator agents writes a debrief.

```
web (React + Vite)  ──REST──▶  api (NestJS)  ──▶ Postgres + pgvector, Redis/BullMQ
        │                          ▲   │
        │ WebRTC (LiveKit Cloud)   │   └─ issues room token that dispatches the agent
        ▼                          │
 livekit-agent (Python) ──internal REST (x-service-key): context · RAG search · notes · transcript
```

## Pipeline

1. **Ingest** (`api/src/documents`): PDF/DOCX/TXT → text → section-aware chunks →
   Gemini embeddings (768-d) in pgvector. A resume/JD analyst agent extracts a structured profile.
2. **Prep** (`api/src/sessions/prep.graph.ts`, LangGraph): fans out one RAG retrieval per JD
   requirement (`Send`), then fit analyst → interview planner.
3. **Interview** (`livekit-agent/`): Greeter → Interviewer → Closer agent handoffs. The interviewer
   has tools: `next_question`, `search_candidate_background` (hybrid RAG), `record_observation`, `wrap_up`.
   Silero VAD, LiveKit semantic turn detector, adaptive interruptions, BVC noise cancellation,
   and a clock watchdog that enforces the time box.
4. **Analysis** (`api/src/sessions/analysis.graph.ts`, LangGraph): technical evaluator ∥
   communication coach ∥ question reviewer → report synthesizer.

Retrieval is hybrid: pgvector cosine + Postgres full-text, merged with Reciprocal Rank Fusion;
it degrades to lexical-only if embeddings are unavailable.

## Model fallbacks (all free tiers)

| | Tier 1 | Tier 2 | Tier 3 |
|---|---|---|---|
| Voice LLM | LiveKit Inference | Gemini | Groq (2 models) |
| STT | LiveKit Inference (Deepgram) | LiveKit Inference (AssemblyAI) | Groq Whisper |
| TTS | LiveKit Inference (Cartesia) | LiveKit Inference (Deepgram) | Groq Orpheus |
| Prep/analysis LLM | Gemini | Groq | Groq fallback |

## Running locally

```bash
cp api/.env.example api/.env                 # fill LiveKit, Gemini, Groq keys
cp livekit-agent/.env.example livekit-agent/.env   # API_SERVICE_KEY must match the API's
docker compose up -d postgres redis

cd api && npm install && npx prisma migrate deploy && npm run start:dev   # DATABASE_URL/REDIS_URL → localhost
cd livekit-agent && uv sync && uv run agent.py download-files && uv run agent.py dev
cd web && npm install && npm run dev        # http://localhost:5173 (proxies /api → :3000)
```

Or run everything in Docker: `docker compose up --build` (plus `npm run dev` in `web/`).
