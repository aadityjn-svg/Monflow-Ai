# Monflow AI

Self-learning AI agent repo for Monflow portal exploration.

## Contents

- `portal-agent/`: Playwright + LangGraph crawler and knowledge generator
- `.github/workflows/portal-learning.yml`: Scheduled and manual GitHub Actions runner

## Setup

Add these GitHub repository secrets before running the workflow:

- `PORTAL_BASE_URL`
- `PORTAL_API_BASE_URL`
- `PORTAL_LOGIN_URL`
- `PORTAL_USERNAME`
- `PORTAL_PASSWORD`
- `PORTAL_ROLE`
- `PORTAL_WORKSPACE_OWNER`
- `AGENT_INGEST_ENDPOINT`
- `AGENT_INGEST_TOKEN`

Then open `Actions` and run `Portal Learning`.
