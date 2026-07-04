import { agentConfig } from "../config/env.js";
import type { LearnedPageDocument } from "../types/index.js";

export async function pushKnowledgeToBackend(pages: LearnedPageDocument[]): Promise<void> {
  if (!agentConfig.crawl.pushToBackend || !agentConfig.crawl.ingestEndpoint || !agentConfig.crawl.ingestToken) {
    return;
  }

  const response = await fetch(agentConfig.crawl.ingestEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-crawler-token": agentConfig.crawl.ingestToken
    },
    body: JSON.stringify({
      workspaceOwner: agentConfig.portal.workspaceOwner || null,
      pages
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Backend ingest failed with ${response.status}: ${body}`);
  }
}
