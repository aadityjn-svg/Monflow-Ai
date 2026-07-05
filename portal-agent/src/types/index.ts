export type PortalRole = "user" | "admin";

export interface PortalCredentials {
  username: string;
  password: string;
  role: PortalRole;
}

export interface CrawlTarget {
  path: string;
  label?: string;
  source: "seed" | "nav" | "link" | "button" | "route" | "manual";
  depth: number;
  navigationPath: string[];
}

export interface UiAction {
  type: "click" | "fill" | "expand" | "open-modal" | "select-tab" | "navigate";
  label: string;
  selector?: string;
  safe: boolean;
  reason?: string;
}

export interface FormFieldInfo {
  name: string;
  label: string;
  type: string;
  required: boolean;
  placeholder?: string;
  options?: string[];
}

export interface FormInfo {
  id: string;
  name: string;
  action?: string;
  method?: string;
  fields: FormFieldInfo[];
  submitLabels: string[];
  validationHints: string[];
}

export interface ConsoleEventInfo {
  type: string;
  text: string;
  location?: string;
}

export interface NetworkRequestInfo {
  url: string;
  method: string;
  resourceType: string;
  status?: number;
  requestBody?: string;
}

export interface PageObservation {
  url: string;
  path: string;
  title: string;
  featureName: string;
  navigationPath: string[];
  headings: string[];
  textSummary: string;
  buttons: string[];
  tabs: string[];
  accordions: string[];
  modals: string[];
  tables: string[];
  filters: string[];
  searches: string[];
  cards: string[];
  charts: string[];
  forms: FormInfo[];
  validationMessages: string[];
  successMessages: string[];
  errorMessages: string[];
  permissions: string[];
  relatedFeatures: string[];
  safeActionsTried: UiAction[];
  consoleEvents: ConsoleEventInfo[];
  networkRequests: NetworkRequestInfo[];
  screenshotPath?: string;
  domExcerpt: string;
  discoveredLinks: CrawlTarget[];
  observedAt: string;
}

export interface LearnedPageDocument {
  pageId: string;
  path: string;
  title: string;
  featureName: string;
  purpose: string;
  navigationPath: string[];
  summary: string;
  workflow: string[];
  faq: string[];
  troubleshooting: string[];
  tips: string[];
  userGuide: string[];
  apiSummary: string[];
  permissions: string[];
  relatedFeatures: string[];
  sourceObservation: PageObservation;
  contentHash: string;
  learnedAt: string;
}

export interface CrawlRunState {
  runId: string;
  startedAt: string;
  visitedPaths: string[];
  queuedTargets: CrawlTarget[];
  failedPaths: Array<{ path: string; error: string }>;
  completedAt?: string;
}

export interface RetrievalResult {
  id: string;
  path: string;
  title: string;
  content: string;
  distance?: number;
  metadata: Record<string, unknown>;
}

export interface CrawlFailure {
  path: string;
  error: string;
}
