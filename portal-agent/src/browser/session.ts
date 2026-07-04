import { chromium, type Browser, type BrowserContext, type ConsoleMessage, type Page, type Request, type Response } from "playwright";
import { agentConfig } from "../config/env.js";
import type { ConsoleEventInfo, NetworkRequestInfo, PortalCredentials } from "../types/index.js";
import { logger } from "../utils/logger.js";

const ACCESS_TOKEN_STORAGE_KEY = "monflow_access_token";
const REFRESH_TOKEN_STORAGE_KEY = "monflow_refresh_token";

interface LoginApiResponse {
  success?: boolean;
  message?: string;
  requiresMfa?: boolean;
  mfaSetupRequired?: boolean;
  session?: {
    accessToken?: string;
    refreshToken?: string;
  };
  user?: {
    role?: string;
  };
}

interface LoginResolution {
  status: "authenticated" | "mfa" | "pending" | "error";
  message?: string;
}

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
    logger.info({ loginUrl: agentConfig.portal.loginUrl, apiBaseUrl: agentConfig.portal.apiBaseUrl }, "Starting portal login");

    const apiSession = await this.loginViaApi(credentials).catch((error) => {
      logger.warn({ error }, "Portal API login path failed");
      return null;
    });
    if (apiSession) {
      logger.info("Portal API login succeeded, applying browser session");
      await this.applySession(apiSession.accessToken, apiSession.refreshToken);
      const verified = await this.verifyAuthenticatedRoute(apiSession.postLoginPath);
      if (verified) return;
      logger.warn("Portal API session was applied but browser verification still returned to login page");
    }

    logger.info("Falling back to UI login");
    await this.loginViaUi(credentials);
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

  async gotoAndSettle(url: string): Promise<void> {
    const page = this.getPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForLoadState("load", { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(1200);
  }

  private async loginViaApi(credentials: PortalCredentials): Promise<{ accessToken: string; refreshToken?: string; postLoginPath: string; }> {
    if (!agentConfig.portal.apiBaseUrl) {
      throw new Error("Portal API base URL is not configured");
    }

    const endpoint = new URL("auth/login", `${agentConfig.portal.apiBaseUrl.replace(/\/+$/, "")}/`).toString();
    logger.info({ endpoint }, "Attempting portal API login");

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        email: credentials.username,
        password: credentials.password
      })
    });

    const body = await response.json() as LoginApiResponse;
    if (!response.ok) {
      logger.warn({ status: response.status, body }, "Portal API login failed");
      throw new Error(body.message || `Portal login API failed with status ${response.status}`);
    }

    if (body.requiresMfa) {
      logger.warn("Portal API login requires MFA");
      throw new Error("Portal crawler account requires MFA. Use a dedicated non-MFA automation user for GitHub Actions.");
    }

    if (!body.session?.accessToken) {
      logger.warn({ body }, "Portal API login did not return session tokens");
      throw new Error(body.message || "Portal login API did not return an access token");
    }

    return {
      accessToken: body.session.accessToken,
      refreshToken: body.session.refreshToken,
      postLoginPath: this.getPostLoginPath(body.user?.role, credentials.role)
    };
  }

  private async applySession(accessToken: string, refreshToken?: string): Promise<void> {
    const page = this.getPage();
    await this.gotoAndSettle(agentConfig.portal.baseUrl);
    await page.evaluate(
      ({ accessToken: nextAccessToken, refreshToken: nextRefreshToken, accessKey, refreshKey }) => {
        localStorage.setItem(accessKey, nextAccessToken);
        if (nextRefreshToken) {
          localStorage.setItem(refreshKey, nextRefreshToken);
        }
      },
      {
        accessToken,
        refreshToken,
        accessKey: ACCESS_TOKEN_STORAGE_KEY,
        refreshKey: REFRESH_TOKEN_STORAGE_KEY
      }
    );
  }

  private async verifyAuthenticatedRoute(postLoginPath: string): Promise<boolean> {
    logger.info({ postLoginPath }, "Verifying authenticated browser route");
    await this.gotoAndSettle(new URL(postLoginPath, agentConfig.portal.baseUrl).toString());
    const resolution = await this.waitForLoginResolution(15_000);
    if (resolution.status === "authenticated") {
      logger.info({ postLoginPath }, "Authenticated browser route verified");
      return true;
    }
    logger.warn({ resolution, postLoginPath }, "Authenticated browser route verification failed");
    return false;
  }

  private async loginViaUi(credentials: PortalCredentials): Promise<void> {
    const page = this.getPage();
    await this.gotoAndSettle(agentConfig.portal.loginUrl);

    const emailSelector = 'input[type="email"], input[name="email"], input[name="username"]';
    const passwordSelector = 'input[type="password"], input[name="password"]';

    await page.locator(emailSelector).first().fill(credentials.username);
    await page.locator(passwordSelector).first().fill(credentials.password);

    const submit = page.locator('button[type="submit"]');
    if (await submit.count()) {
      await submit.first().click();
    } else {
      await page.locator(passwordSelector).first().press("Enter");
    }

    const resolution = await this.waitForLoginResolution(20_000);
    if (resolution.status === "authenticated") {
      logger.info("UI login reached authenticated state");
      return;
    }

    if (resolution.status === "mfa") {
      logger.warn("UI login requires MFA");
      throw new Error("Portal crawler account requires MFA. Use a dedicated non-MFA automation user for GitHub Actions.");
    }

    logger.warn({
      resolution,
      currentUrl: page.url()
    }, "UI login failed to resolve");

    logger.warn({ resolution }, "UI login failed to resolve");
    throw new Error(resolution.message || "Login appears to have failed because the browser remained on the login page");
  }

  private async waitForLoginResolution(timeoutMs: number): Promise<LoginResolution> {
    const page = this.getPage();
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const currentUrl = page.url();
      const state = await page.evaluate(
        ({ accessKey }) => {
          const bodyText = document.body?.innerText?.replace(/\s+/g, " ").trim() || "";
          const hasAccessToken = Boolean(localStorage.getItem(accessKey));
          const normalizedText = bodyText.toLowerCase();

          return {
            hasAccessToken,
            isMfa:
              normalizedText.includes("complete secure verification")
              || normalizedText.includes("password verified for")
              || normalizedText.includes("verification method"),
            hasDashboardHint:
              normalizedText.includes("dashboard")
              || normalizedText.includes("logout")
              || normalizedText.includes("profile")
              || normalizedText.includes("admin"),
            errorMessage:
              bodyText.match(/invalid email or password|account temporarily locked|login failed|mfa verification required/i)?.[0]
              || ""
          };
        },
        { accessKey: ACCESS_TOKEN_STORAGE_KEY }
      );

      if (!/\/login\b/i.test(currentUrl)) {
        return { status: "authenticated" };
      }

      if (state.hasDashboardHint && state.hasAccessToken) {
        return { status: "authenticated" };
      }

      if (state.isMfa) {
        return { status: "mfa" };
      }

      if (state.hasAccessToken) {
        const fallbackPath = this.getPostLoginPath(undefined, agentConfig.portal.credentials.role);
        await this.gotoAndSettle(new URL(fallbackPath, agentConfig.portal.baseUrl).toString());
        if (!/\/login\b/i.test(page.url())) {
          return { status: "authenticated" };
        }
      }

      if (state.errorMessage) {
        return { status: "error", message: state.errorMessage };
      }

      await page.waitForTimeout(500);
    }

    return { status: "pending", message: `Login did not resolve within ${timeoutMs}ms` };
  }

  private getPostLoginPath(userRole: string | undefined, configuredRole: PortalCredentials["role"]): string {
    if (userRole === "admin" || userRole === "superadmin" || configuredRole === "admin") {
      return "/admin";
    }
    return "/dashboard";
  }
}
