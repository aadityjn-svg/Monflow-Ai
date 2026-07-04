import type { LearnedPageDocument } from "../types/index.js";
import { FileStateStore } from "../persistence/file-state.js";

export class ChangeDetector {
  constructor(private readonly stateStore = new FileStateStore()) {}

  async detect(document: LearnedPageDocument): Promise<{ shouldRelearn: boolean; previousHash?: string }> {
    const index = await this.stateStore.readPageIndex();
    const previous = index[document.path];
    if (!previous) return { shouldRelearn: true, previousHash: undefined };
    return {
      shouldRelearn: previous.contentHash !== document.contentHash,
      previousHash: previous.contentHash
    };
  }
}
