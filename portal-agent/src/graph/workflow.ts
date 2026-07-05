import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { CrawlFailure, CrawlTarget, LearnedPageDocument, PageObservation } from "../types/index.js";
import { PortalSession } from "../browser/session.js";
import { adminRouteSeeds, userRouteSeeds } from "../browser/seed-routes.js";
import { extractObservation, fillFormsWithSampleData, performSafeInteractions } from "../browser/extractor.js";
import { generateLearnedDocument } from "../learning/documenter.js";
import { ChromaKnowledgeStore } from "../knowledge/chroma-store.js";
import { pushKnowledgeToBackend } from "../knowledge/pusher.js";
import { FileStateStore } from "../persistence/file-state.js";
import { ChangeDetector } from "../crawler/change-detector.js";
import { agentConfig } from "../config/env.js";
import { ensureDir, writeJson } from "../utils/fs.js";
import { logger } from "../utils/logger.js";

const CrawlState = Annotation.Root({
  runId: Annotation<string>(),
  queue: Annotation<CrawlTarget[]>(),
  visited: Annotation<Set<string>>(),
  observations: Annotation<PageObservation[]>(),
  learned: Annotation<LearnedPageDocument[]>(),
  currentTarget: Annotation<CrawlTarget | null>(),
  pageCount: Annotation<number>(),
  failures: Annotation<CrawlFailure[]>()
});

function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

function buildSeedQueue(): CrawlTarget[] {
  const seeds = agentConfig.portal.credentials.role === "admin" ? adminRouteSeeds : userRouteSeeds;
  return seeds.map((seed) => ({
    path: seed,
    source: "seed",
    depth: 0,
    navigationPath: [seed]
  }));
}

function dedupeTargets(targets: CrawlTarget[]): CrawlTarget[] {
  const seen = new Set<string>();
  const deduped: CrawlTarget[] = [];

  for (const target of targets) {
    const path = normalizePath(target.path);
    if (seen.has(path)) continue;
    seen.add(path);
    deduped.push({
      ...target,
      path
    });
  }

  return deduped;
}

async function buildInitialQueue(stateStore: FileStateStore): Promise<CrawlTarget[]> {
  const previous = await stateStore.readRunState();
  const resumedTargets = Array.isArray(previous.queuedTargets) ? previous.queuedTargets : [];
  const failedTargets = Array.isArray(previous.failedPaths)
    ? previous.failedPaths.map((item) => ({
        path: item.path,
        source: "manual" as const,
        depth: 0,
        navigationPath: [item.path]
      }))
    : [];

  const seeds = buildSeedQueue();
  return dedupeTargets([...resumedTargets, ...failedTargets, ...seeds]);
}

async function withRetry<T>(task: () => Promise<T>, retries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function withTimeout<T>(task: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([task, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function formatErrorDetails(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack
    };
  }

  return {
    message: String(error)
  };
}

export async function runLearningWorkflow(): Promise<LearnedPageDocument[]> {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const session = new PortalSession();
  const store = agentConfig.ollama.enabled ? new ChromaKnowledgeStore() : null;
  const stateStore = new FileStateStore();
  const changeDetector = new ChangeDetector(stateStore);

  return withTimeout((async () => {
    const page = await session.start();
    const artifactRoot = path.resolve(agentConfig.crawl.outputDir, "runs", runId);
    const screenshotDir = path.join(artifactRoot, "screenshots");
    const pageDir = path.join(artifactRoot, "pages");
    await ensureDir(screenshotDir);
    await ensureDir(pageDir);

    logger.info({ runId, maxPages: agentConfig.crawl.maxPages }, "Starting learning workflow");
    await withTimeout(session.login(agentConfig.portal.credentials), 45_000, "Portal login");

    const initialQueue = await buildInitialQueue(stateStore);

    const graph = new StateGraph(CrawlState)
      .addNode("pickTarget", async (state) => {
        const next = state.queue.find((target) => !state.visited.has(normalizePath(target.path)));
        return {
          ...state,
          currentTarget: next ?? null
        };
      })
      .addNode("visitPage", async (state) => {
        if (!state.currentTarget) return state;

        const targetPath = normalizePath(state.currentTarget.path);
        const url = new URL(targetPath, agentConfig.portal.baseUrl).toString();
        logger.info({ runId, targetPath }, "Visiting page");

        try {
          await withRetry(() => withTimeout(session.gotoAndSettle(url), 45_000, `Navigation for ${targetPath}`), 1);
          const safeActions = agentConfig.crawl.enableSafeInteractions
            ? await withTimeout(performSafeInteractions(page), 10_000, `Safe interactions for ${targetPath}`).catch(() => [])
            : [];
          const formActions = agentConfig.crawl.enableFormFill
            ? await withTimeout(fillFormsWithSampleData(page), 10_000, `Form fill for ${targetPath}`).catch(() => [])
            : [];
          const screenshotPath = path.join(screenshotDir, `${targetPath.replace(/[^\w-]+/g, "_") || "home"}.png`);
          await withTimeout(page.screenshot({ path: screenshotPath, fullPage: true }), 15_000, `Screenshot for ${targetPath}`);

          const observation = await withTimeout(
            extractObservation(
              page,
              targetPath,
              state.currentTarget.navigationPath,
              [...safeActions, ...formActions],
              screenshotPath
            ),
            20_000,
            `Observation extraction for ${targetPath}`
          );
          observation.consoleEvents = session.drainConsoleEvents();
          observation.networkRequests = session.drainNetworkRequests();

          const nextQueue = [...state.queue];
          if (agentConfig.crawl.followDiscoveredLinks) {
            for (const discovered of observation.discoveredLinks) {
              const normalized = normalizePath(discovered.path);
              const sameOrigin = normalized.startsWith("/") && state.currentTarget.depth + 1 <= agentConfig.crawl.maxDepth;
              const unseen = !state.visited.has(normalized) && !nextQueue.some((item) => normalizePath(item.path) === normalized);
              if (sameOrigin && unseen) {
                nextQueue.push({
                  ...discovered,
                  depth: state.currentTarget.depth + 1,
                  navigationPath: [...state.currentTarget.navigationPath, discovered.label || discovered.path]
                });
              }
            }
          }

          logger.info({ runId, targetPath }, "Page observation captured");
          return {
            ...state,
            queue: nextQueue,
            visited: new Set([...state.visited, targetPath]),
            observations: [...state.observations, observation],
            pageCount: state.pageCount + 1
          };
        } catch (error) {
          logger.warn({ runId, targetPath, error }, "Failed to visit page");
          return {
            ...state,
            visited: new Set([...state.visited, targetPath]),
            failures: [
              ...state.failures,
              {
                path: targetPath,
                error: error instanceof Error ? error.message : String(error)
              }
            ],
            pageCount: state.pageCount + 1
          };
        }
      })
      .addNode("learnPage", async (state) => {
        const latest = state.observations[state.observations.length - 1];
        if (!latest) return state;

        try {
          logger.info({ runId, path: latest.path }, "Generating learned page document");
          const learned = await generateLearnedDocument(latest);
          const { shouldRelearn, previousHash } = await changeDetector.detect(learned);

          if (shouldRelearn) {
            if (store) {
              await store.upsert(learned);
            }
            await stateStore.appendChangeRecord(learned.path, previousHash, learned.contentHash);
            await stateStore.updatePageIndex(learned);
          }

          await writeJson(path.join(pageDir, `${learned.pageId}.json`), learned);
          logger.info({ runId, path: learned.path }, "Learned page document written");

          return {
            ...state,
            learned: [...state.learned, learned]
          };
        } catch (error) {
          logger.error({ runId, path: latest.path, error: formatErrorDetails(error) }, "Learn page step failed");
          return {
            ...state,
            failures: [
              ...state.failures,
              {
                path: latest.path,
                error: error instanceof Error ? error.message : String(error)
              }
            ]
          };
        }
      })
      .addConditionalEdges("pickTarget", (state) => {
        if (!state.currentTarget || state.pageCount >= agentConfig.crawl.maxPages) return END;
        return "visitPage";
      })
      .addEdge("visitPage", "learnPage")
      .addEdge("learnPage", "pickTarget")
      .addEdge(START, "pickTarget");

    const app = graph.compile();
    const result = await app.invoke({
      runId,
      queue: initialQueue,
      visited: new Set<string>(),
      observations: [],
      learned: [],
      currentTarget: null,
      pageCount: 0,
      failures: []
    }, {
      recursionLimit: Math.max(50, agentConfig.crawl.maxPages * 4)
    });

    await stateStore.writeRunState({
      runId,
      startedAt,
      visitedPaths: [...result.visited],
      queuedTargets: dedupeTargets(result.queue.filter((item) => !result.visited.has(normalizePath(item.path)))),
      failedPaths: result.failures,
      completedAt: new Date().toISOString()
    });

    await pushKnowledgeToBackend(result.learned).catch((error) => {
      logger.warn({ runId, error: formatErrorDetails(error) }, "Final backend ingest failed");
    });

    logger.info({ runId, learned: result.learned.length, failures: result.failures.length }, "Learning run completed");
    return result.learned;
  })(), 14 * 60_000, "Learning workflow").finally(async () => {
    await session.stop().catch((error) => {
      logger.warn({ runId, error }, "Failed to stop browser session cleanly");
    });
  });
}
