import { agentConfig } from "../config/env.js";
import type { LearnedPageDocument } from "../types/index.js";

const BATCH_SIZE = 20;
const MAX_RETRIES = 4;
const BASE_DELAY_MS = 1_500;

function chunkPages(pages: LearnedPageDocument[], size: number): LearnedPageDocument[][] {
  const chunks: LearnedPageDocument[][] = [];
  for (let index = 0; index < pages.length; index += size) {
    chunks.push(pages.slice(index, index + size));
  }
  return chunks;
}

function getRetryDelayMs(attempt: number, retryAfterHeader: string | null): number {
  const retryAfterSeconds = Number(retryAfterHeader || "");
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return retryAfterSeconds * 1_000;
  }

  return BASE_DELAY_MS * 2 ** attempt;
}

async function postPages(batch: LearnedPageDocument[], attempt = 0): Promise<void> {
  const response = await fetch(agentConfig.crawl.ingestEndpoint!, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-crawler-token": agentConfig.crawl.ingestToken!
    },
    body: JSON.stringify({
      workspaceOwner: agentConfig.portal.workspaceOwner || null,
      pages: batch
    })
  });

  if (response.ok) {
    return;
  }

  if (response.status === 429 && attempt < MAX_RETRIES) {
    const delayMs = getRetryDelayMs(attempt, response.headers.get("retry-after"));
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return postPages(batch, attempt + 1);
  }

  const body = await response.text();
  throw new Error(`Backend ingest failed with ${response.status}: ${body}`);
}

export async function pushKnowledgeToBackend(pages: LearnedPageDocument[]): Promise<void> {
  if (!agentConfig.crawl.pushToBackend || !agentConfig.crawl.ingestEndpoint || !agentConfig.crawl.ingestToken) {
    return;
  }

  if (!pages.length) {
    return;
  }

  const batches = chunkPages(pages, BATCH_SIZE);
  for (const batch of batches) {
    await postPages(batch);
  }
}

export async function pushSinglePageToBackend(page: LearnedPageDocument): Promise<void> {
  await pushKnowledgeToBackend([page]);
}
