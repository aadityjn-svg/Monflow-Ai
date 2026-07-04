# Monflow Portal Agent

Self-learning AI agent for the Monflow portal. It explores the UI with Playwright, extracts feature knowledge, stores it in ChromaDB, and answers portal questions with RAG using Ollama.

## What it does

- Logs into the portal with configured credentials
- Discovers pages from navigation, links, routes, tabs, and safe buttons
- Captures DOM summaries, screenshots, console errors, and network calls
- Extracts forms, tables, filters, modals, validations, workflows, and permissions
- Generates feature summaries, guides, FAQs, troubleshooting notes, and tips
- Stores page knowledge and embeddings in ChromaDB
- Detects changes incrementally and re-learns only changed pages
- Can run in zero-budget mode without Ollama and push learned knowledge to the Render backend

## Install

```bash
cd billing-platform/portal-agent
npm install
cp .env.example .env
```

Required local services:

- Monflow frontend and backend running
- Optional: Ollama running locally with `qwen3` and an embedding model
- Optional: ChromaDB running locally

Example:

```bash
ollama pull qwen3
ollama pull nomic-embed-text
docker run -p 8000:8000 chromadb/chroma
```

## Zero-budget GitHub Actions mode

Set:

```bash
AGENT_ENABLE_LLM=false
AGENT_PUSH_TO_BACKEND=true
AGENT_INGEST_ENDPOINT=https://your-render-backend.onrender.com/api/assistant/ingest
AGENT_INGEST_TOKEN=your-secret-token
```

In this mode:

- Playwright still logs in and explores the portal
- Structured knowledge is generated from rules and observations
- Learned pages are pushed to the backend assistant memory store
- Ollama and Chroma are not required for scheduled crawls

## Run learning

```bash
npm run dev:learn
```

## Ask questions

```bash
npm run dev:ask -- "How do I create a payment receipt?"
```

## Output

Artifacts are written under `artifacts/` by default:

- `runs/<runId>/pages/*.json`
- `runs/<runId>/screenshots/*.png`
- `state/page-index.json`
- `state/change-index.json`

## Architecture

- `src/browser`: Playwright automation and safe interaction
- `src/learning`: extraction and documentation generation
- `src/graph`: LangGraph orchestration
- `src/knowledge`: ChromaDB storage and retrieval
- `src/crawler`: incremental crawl planning and change detection
- `src/persistence`: local run state and snapshots

## Safety

The agent blocks destructive actions by default. It will not click controls with labels such as delete, remove, approve, reject, transfer, withdraw, submit payment, or similar high-risk actions while `AGENT_SAFE_MODE=true`.
