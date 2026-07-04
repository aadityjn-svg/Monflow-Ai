import { runLearningWorkflow } from "../graph/workflow.js";
import { logger } from "../utils/logger.js";

async function main(): Promise<void> {
  const learned = await runLearningWorkflow();
  logger.info({ pagesLearned: learned.length }, "Portal learning finished");
}

main().catch((error) => {
  logger.error(error, "Portal learning failed");
  process.exitCode = 1;
});
