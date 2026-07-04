import { ChatOllama } from "@langchain/ollama";
import { agentConfig } from "../config/env.js";
import { sha256 } from "../utils/hashing.js";
import type { LearnedPageDocument, PageObservation } from "../types/index.js";
import { logger } from "../utils/logger.js";

let llm: ChatOllama | null = null;

function getLlm(): ChatOllama {
  if (!llm) {
    llm = new ChatOllama({
      baseUrl: agentConfig.ollama.baseUrl,
      model: agentConfig.ollama.chatModel,
      temperature: 0.1
    });
  }
  return llm;
}

function buildRuleBasedDocument(observation: PageObservation): LearnedPageDocument {
  const workflow = [
    `Open ${observation.path} from ${observation.navigationPath.join(" > ") || "the portal navigation"}.`,
    ...observation.tabs.slice(0, 2).map((tab) => `Review the ${tab} section or tab.`),
    ...observation.forms.slice(0, 1).flatMap((form) => form.fields.slice(0, 3).map((field) => `Fill ${field.label || field.name}.`)),
    ...observation.buttons
      .filter((label) => /new|create|add|save|search|filter|view/i.test(label))
      .slice(0, 3)
      .map((label) => `Use ${label} to continue the workflow.`),
  ].filter(Boolean);

  const purpose = observation.textSummary.slice(0, 280) || `Manage ${observation.featureName} in the portal.`;
  const summary = [
    `${observation.featureName} is available at ${observation.path}.`,
    observation.headings.length ? `Key sections include ${observation.headings.slice(0, 4).join(", ")}.` : "",
    observation.forms.length ? `The page contains ${observation.forms.length} form(s).` : "",
    observation.tables.length ? `The page shows table/report content.` : "",
  ].filter(Boolean).join(" ");

  return {
    pageId: sha256(observation.path),
    path: observation.path,
    title: observation.title,
    featureName: observation.featureName,
    purpose,
    navigationPath: observation.navigationPath,
    summary,
    workflow,
    faq: [
      `How do I open ${observation.featureName}? Go to ${observation.path}.`,
      observation.forms.length ? `What can I fill on this page? ${observation.forms[0].fields.slice(0, 5).map((field) => field.label || field.name).join(", ")}.` : "",
    ].filter(Boolean),
    troubleshooting: [
      ...observation.errorMessages.slice(0, 3),
      ...observation.validationMessages.slice(0, 3),
    ],
    tips: [
      ...observation.filters.slice(0, 2).map((item) => `Use ${item} to narrow results.`),
      ...observation.searches.slice(0, 2).map((item) => `Use ${item} to quickly find records.`),
    ],
    userGuide: workflow,
    apiSummary: observation.networkRequests
      .filter((request) => /\/api\//i.test(request.url))
      .slice(0, 8)
      .map((request) => `${request.method} ${request.url}`),
    permissions: observation.permissions,
    relatedFeatures: observation.relatedFeatures,
    sourceObservation: observation,
    contentHash: sha256(JSON.stringify({
      path: observation.path,
      title: observation.title,
      textSummary: observation.textSummary,
      forms: observation.forms,
      buttons: observation.buttons,
      networkRequests: observation.networkRequests.map((request) => [request.method, request.url, request.status])
    })),
    learnedAt: new Date().toISOString()
  };
}

export async function generateLearnedDocument(observation: PageObservation): Promise<LearnedPageDocument> {
  if (!agentConfig.ollama.enabled) {
    return buildRuleBasedDocument(observation);
  }

  const prompt = `
You are documenting a SaaS billing portal feature from browser observations.
Return strict JSON with these keys:
purpose, summary, workflow, faq, troubleshooting, tips, userGuide, apiSummary, permissions, relatedFeatures.

Page path: ${observation.path}
Feature name: ${observation.featureName}
Title: ${observation.title}
Navigation path: ${observation.navigationPath.join(" > ")}
Headings: ${JSON.stringify(observation.headings)}
Buttons: ${JSON.stringify(observation.buttons)}
Forms: ${JSON.stringify(observation.forms)}
Tables: ${JSON.stringify(observation.tables)}
Filters: ${JSON.stringify(observation.filters)}
Search: ${JSON.stringify(observation.searches)}
Cards: ${JSON.stringify(observation.cards)}
Charts: ${JSON.stringify(observation.charts)}
Validation messages: ${JSON.stringify(observation.validationMessages)}
Success messages: ${JSON.stringify(observation.successMessages)}
Error messages: ${JSON.stringify(observation.errorMessages)}
Permissions: ${JSON.stringify(observation.permissions)}
Related features: ${JSON.stringify(observation.relatedFeatures)}
APIs observed: ${JSON.stringify(observation.networkRequests.map((request) => `${request.method} ${request.url} ${request.status || ""}`))}
Text summary: ${observation.textSummary}

Rules:
- Infer cautiously from only the observed evidence.
- Keep each FAQ, troubleshooting item, tip, and guide step concise.
- Mention uncertainty only when evidence is weak.
- Return valid JSON only.
`;

  try {
    const response = await getLlm().invoke(prompt);
    const raw = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    const structured = JSON.parse(cleaned) as Omit<LearnedPageDocument, "pageId" | "path" | "title" | "featureName" | "navigationPath" | "sourceObservation" | "contentHash" | "learnedAt">;

    const contentHash = sha256(JSON.stringify({
      path: observation.path,
      title: observation.title,
      textSummary: observation.textSummary,
      forms: observation.forms,
      buttons: observation.buttons,
      networkRequests: observation.networkRequests.map((request) => [request.method, request.url, request.status])
    }));

    return {
      pageId: sha256(observation.path),
      path: observation.path,
      title: observation.title,
      featureName: observation.featureName,
      purpose: structured.purpose,
      navigationPath: observation.navigationPath,
      summary: structured.summary,
      workflow: structured.workflow || [],
      faq: structured.faq || [],
      troubleshooting: structured.troubleshooting || [],
      tips: structured.tips || [],
      userGuide: structured.userGuide || [],
      apiSummary: structured.apiSummary || [],
      permissions: structured.permissions || observation.permissions,
      relatedFeatures: structured.relatedFeatures || observation.relatedFeatures,
      sourceObservation: observation,
      contentHash,
      learnedAt: new Date().toISOString()
    };
  } catch (error) {
    logger.warn({ error }, "Falling back to rule-based documentation");
    return buildRuleBasedDocument(observation);
  }
}
