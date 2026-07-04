import path from "node:path";
import { agentConfig } from "../config/env.js";
import type { CrawlRunState, LearnedPageDocument } from "../types/index.js";
import { readJson, writeJson } from "../utils/fs.js";

interface PageIndexRecord {
  path: string;
  contentHash: string;
  learnedAt: string;
}

interface ChangeIndexRecord {
  path: string;
  previousHash?: string;
  currentHash: string;
  changedAt: string;
}

export class FileStateStore {
  private baseDir = path.resolve(agentConfig.crawl.outputDir);
  private stateDir = path.join(this.baseDir, "state");

  async readRunState(): Promise<CrawlRunState> {
    return readJson(path.join(this.stateDir, "crawl-run.json"), {
      runId: "",
      startedAt: "",
      visitedPaths: [],
      queuedPaths: [],
      failedPaths: []
    });
  }

  async writeRunState(state: CrawlRunState): Promise<void> {
    await writeJson(path.join(this.stateDir, "crawl-run.json"), state);
  }

  async readPageIndex(): Promise<Record<string, PageIndexRecord>> {
    return readJson(path.join(this.stateDir, "page-index.json"), {});
  }

  async updatePageIndex(document: LearnedPageDocument): Promise<void> {
    const index = await this.readPageIndex();
    index[document.path] = {
      path: document.path,
      contentHash: document.contentHash,
      learnedAt: document.learnedAt
    };
    await writeJson(path.join(this.stateDir, "page-index.json"), index);
  }

  async appendChangeRecord(pathname: string, previousHash: string | undefined, currentHash: string): Promise<void> {
    const index = await readJson<Record<string, ChangeIndexRecord>>(path.join(this.stateDir, "change-index.json"), {});
    index[pathname] = {
      path: pathname,
      previousHash,
      currentHash,
      changedAt: new Date().toISOString()
    };
    await writeJson(path.join(this.stateDir, "change-index.json"), index);
  }
}
