import { chromium, type Browser, type BrowserContext, type ConsoleMessage, type Page, type Request, type Response } from "playwright";
import { agentConfig } from "../config/env.js";
import type { ConsoleEventInfo, NetworkRequestInfo, PortalCredentials } from "../types/index.js";

export class PortalSession {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private consoleEvents: ConsoleEventInfo[] = [];
  private networkRequests: NetworkRequestInfo[] = [];

  async start(): Promise<Page> {
    this.browser = await chromium.launch({
      headless: agentConfig.crawl.headless,
      slowMo: agentConfig.crawl.slowMo
    });

    this.context = await this.browser.newContext({
      viewport: { width: 1440, height: 960 },
      ignoreHTTPSErrors: true
    });

    this.page = await this.context.newPage();
    this.page.on("console", (message) => this.captureConsole(message));
    this.page.on("request", (request) => this.captureRequest(request));
    this.page.on("response", (response) => this.captureResponse(response));
    return this.page;
  }

  getPage(): Page {
    if (!this.page) throw new Error("Browser session not started");
    return this.page;
  }

  drainConsoleEvents(): ConsoleEventInfo[] {
    const snapshot = [...this.consoleEvents];
    this.consoleEvents = [];
    return snapshot;
  }

  drainNetworkRequests(): NetworkRequestInfo[] {
    const snapshot = [...this.networkRequests];
    this.networkRequests = [];
    return snapshot;
  }

  async login(credentials: PortalCredentials): Promise<void> {
    const page = this.getPage();
    await page.goto(agentConfig.portal.loginUrl, { waitUntil: "networkidle" });

    const emailSelector = 'input[type="email"], input[name="email"], input[name="username"]';
    const passwordSelector = 'input[type="password"], input[name="password"]';

    await page.locator(emailSelector).first().fill(credentials.username);
    await page.locator(passwordSelector).first().fill(credentials.password);

    const submit = page.getByRole("button", { name: /login|sign in|continue/i }).first();
    await submit.click();
    await page.waitForLoadState("networkidle");

    const currentUrl = page.url();
    if (/login/i.test(currentUrl)) {
      throw new Error("Login appears to have failed because the browser remained on the login page");
    }
  }

  async stop(): Promise<void> {
    await this.context?.close();
    await this.browser?.close();
  }

  private captureConsole(message: ConsoleMessage): void {
    this.consoleEvents.push({
      type: message.type(),
      text: message.text(),
      location: message.location().url
    });
  }

  private captureRequest(request: Request): void {
    this.networkRequests.push({
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      requestBody: request.postData() || undefined
    });
  }

  private captureResponse(response: Response): void {
    const requestUrl = response.url();
    const existing = [...this.networkRequests].reverse().find((item) => item.url === requestUrl && item.status === undefined);
    if (existing) {
      existing.status = response.status();
    }
  }
}
