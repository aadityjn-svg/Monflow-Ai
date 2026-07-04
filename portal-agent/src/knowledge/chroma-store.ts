import { ChromaClient, type Collection } from "chromadb";
import { OllamaEmbeddings } from "@langchain/ollama";
import { agentConfig } from "../config/env.js";
import type { LearnedPageDocument, RetrievalResult } from "../types/index.js";

export class ChromaKnowledgeStore {
  private client = new ChromaClient({ path: agentConfig.chroma.url });
  private embeddings = new OllamaEmbeddings({
    baseUrl: agentConfig.ollama.baseUrl,
    model: agentConfig.ollama.embeddingModel
  });
  private collectionPromise?: Promise<Collection>;

  private async getCollection(): Promise<Collection> {
    if (!this.collectionPromise) {
      this.collectionPromise = this.client.getOrCreateCollection({
        name: agentConfig.chroma.collectionName,
        metadata: { description: "Monflow portal self-learning knowledge base" }
      });
    }
    return this.collectionPromise;
  }

  async upsert(document: LearnedPageDocument): Promise<void> {
    const collection = await this.getCollection();
    const content = [
      `Feature: ${document.featureName}`,
      `Path: ${document.path}`,
      `Purpose: ${document.purpose}`,
      `Summary: ${document.summary}`,
      `User guide: ${document.userGuide.join(" ")}`,
      `Workflow: ${document.workflow.join(" ")}`,
      `FAQ: ${document.faq.join(" ")}`,
      `Troubleshooting: ${document.troubleshooting.join(" ")}`,
      `Tips: ${document.tips.join(" ")}`
    ].join("\n");

    const embeddings = await this.embeddings.embedQuery(content);

    await collection.upsert({
      ids: [document.pageId],
      documents: [content],
      embeddings: [embeddings],
      metadatas: [{
        path: document.path,
        title: document.title,
        featureName: document.featureName,
        purpose: document.purpose,
        contentHash: document.contentHash,
        learnedAt: document.learnedAt
      }]
    });
  }

  async query(question: string, limit = 5): Promise<RetrievalResult[]> {
    const collection = await this.getCollection();
    const embedding = await this.embeddings.embedQuery(question);
    const results = await collection.query({
      queryEmbeddings: [embedding],
      nResults: limit
    });

    const ids = results.ids[0] || [];
    const documents = results.documents[0] || [];
    const metadatas = results.metadatas[0] || [];
    const distances = results.distances?.[0] || [];

    return ids.map((id, index) => ({
      id,
      path: String(metadatas[index]?.path || ""),
      title: String(metadatas[index]?.title || ""),
      content: String(documents[index] || ""),
      distance: distances[index],
      metadata: metadatas[index] || {}
    }));
  }
}
