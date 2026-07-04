import { ChatOllama } from "@langchain/ollama";
import { agentConfig } from "../config/env.js";
import { ChromaKnowledgeStore } from "./chroma-store.js";

const llm = new ChatOllama({
  baseUrl: agentConfig.ollama.baseUrl,
  model: agentConfig.ollama.chatModel,
  temperature: 0.2
});

export async function answerPortalQuestion(question: string, store = new ChromaKnowledgeStore()): Promise<string> {
  const context = await store.query(question, 5);
  const prompt = `
Answer the portal question using the retrieved knowledge.
If evidence is incomplete, say what is known and mention the relevant page path.

Question: ${question}

Knowledge:
${context.map((item, index) => `Source ${index + 1} (${item.path}):\n${item.content}`).join("\n\n")}
`;

  const response = await llm.invoke(prompt);
  return typeof response.content === "string" ? response.content : JSON.stringify(response.content);
}
