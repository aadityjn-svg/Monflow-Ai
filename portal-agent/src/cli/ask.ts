import { answerPortalQuestion } from "../knowledge/retriever.js";

async function main(): Promise<void> {
  const question = process.argv.slice(2).join(" ").trim();
  if (!question) {
    throw new Error("Provide a question, for example: npm run dev:ask -- \"How do I create an invoice?\"");
  }

  const answer = await answerPortalQuestion(question);
  process.stdout.write(`${answer}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
