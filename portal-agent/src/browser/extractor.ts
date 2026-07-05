import type { Page } from "playwright";
import type { CrawlTarget, FormFieldInfo, FormInfo, PageObservation, UiAction } from "../types/index.js";
import { isSafeLabel } from "./safety.js";

function compactText(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function normalizeDiscoveredPath(value: string): string | null {
  if (!value) return null;

  try {
    const url = new URL(value, "https://monflow.local");
    const path = (url.pathname || "").replace(/\/+$/, "") || "/";

    if (!path.startsWith("/")) return null;
    if (path === "/login" || path === "/register" || path === "/forgot-password") return null;
    if (path.startsWith("/reset-password/")) return null;
    if (path.startsWith("/forms/")) return null;

    const segments = path.split("/").filter(Boolean);
    const hasDynamicId = segments.some((segment) =>
      /^[a-f0-9]{24}$/i.test(segment)
      || /^[0-9]{5,}$/.test(segment)
      || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment)
    );

    if (hasDynamicId && !path.endsWith("/edit")) {
      return null;
    }

    return path;
  } catch {
    return null;
  }
}

async function collectTexts(page: Page, selector: string): Promise<string[]> {
  return compactText(await page.locator(selector).evaluateAll((nodes) =>
    nodes.map((node) => (node.textContent || "").trim())
  ));
}

async function collectFormInfo(page: Page): Promise<FormInfo[]> {
  const forms = page.locator("form");
  const count = await forms.count();
  const items: FormInfo[] = [];

  for (let index = 0; index < count; index += 1) {
    const form = forms.nth(index);
    const fieldData = await form.locator("input, textarea, select").evaluateAll((nodes) => {
      return nodes.map((node) => {
        const input = node as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
        const label =
          input.getAttribute("aria-label")
          || document.querySelector(`label[for="${input.id}"]`)?.textContent
          || input.getAttribute("name")
          || input.getAttribute("placeholder")
          || "";

        const options = input.tagName === "SELECT"
          ? Array.from((input as HTMLSelectElement).options).map((option) => option.textContent || "").filter(Boolean)
          : [];

        return {
          name: input.getAttribute("name") || input.id || "",
          label: label.trim(),
          type: input.getAttribute("type") || input.tagName.toLowerCase(),
          required: input.hasAttribute("required") || input.getAttribute("aria-required") === "true",
          placeholder: input.getAttribute("placeholder") || undefined,
          options
        };
      });
    });

    const fields: FormFieldInfo[] = fieldData.filter((field) => field.name || field.label);
    const submitLabels = compactText(await form.locator('button, input[type="submit"]').evaluateAll((nodes) =>
      nodes.map((node) => {
        const input = node as HTMLInputElement;
        return input.value || node.textContent || "";
      })
    ));

    const validationHints = compactText(await form.locator(".error, .text-red-500, [role='alert'], [aria-live='polite']").evaluateAll((nodes) =>
      nodes.map((node) => node.textContent || "")
    ));

    items.push({
      id: `form-${index + 1}`,
      name: (await form.getAttribute("name")) || `form-${index + 1}`,
      action: (await form.getAttribute("action")) || undefined,
      method: (await form.getAttribute("method")) || undefined,
      fields,
      submitLabels,
      validationHints
    });
  }

  return items;
}

async function discoverLinks(page: Page, depth: number, navigationPath: string[]): Promise<CrawlTarget[]> {
  const routeCandidates = await page.locator("a[href], [data-to], [data-href], [data-path], button, [role='tab']").evaluateAll((nodes) =>
    nodes.map((node) => {
      const element = node as HTMLElement;
      return {
        href: element.getAttribute("href")
          || element.getAttribute("data-to")
          || element.getAttribute("data-href")
          || element.getAttribute("data-path")
          || "",
        label: (element.textContent || element.getAttribute("aria-label") || "").trim(),
        source: element.tagName.toLowerCase() === "a" ? "link" : "button"
      };
    })
  );

  const discovered = routeCandidates
    .map((item) => {
      const path = normalizeDiscoveredPath(item.href);
      if (!path) return null;

      const target: CrawlTarget = {
        path,
        label: item.label || undefined,
        source: item.source as CrawlTarget["source"],
        depth,
        navigationPath
      };

      return target;
    })
    .filter((item): item is CrawlTarget => item !== null);

  return discovered;
}

export async function extractObservation(
  page: Page,
  currentPath: string,
  navigationPath: string[],
  safeActionsTried: UiAction[],
  screenshotPath?: string
): Promise<PageObservation> {
  const title = await page.title();
  const headings = await collectTexts(page, "h1, h2, h3");
  const buttons = await collectTexts(page, "button");
  const links = await collectTexts(page, "nav a, aside a, a[href]");
  const tabs = await collectTexts(page, '[role="tab"], [data-state="active"][role="button"]');
  const accordions = await collectTexts(page, "[aria-expanded='true'], [data-state='open']");
  const modals = await collectTexts(page, '[role="dialog"], [aria-modal="true"]');
  const tables = await collectTexts(page, "table caption, table thead tr");
  const filters = await collectTexts(page, '[data-testid*="filter"], [placeholder*="filter" i], label');
  const searches = await collectTexts(page, 'input[type="search"], [placeholder*="search" i]');
  const cards = await collectTexts(page, "[class*='card'], article");
  const charts = await collectTexts(page, "svg text, .recharts-text");
  const forms = await collectFormInfo(page);
  const validationMessages = await collectTexts(page, ".error, .text-red-500, [role='alert']");
  const successMessages = await collectTexts(page, ".text-green-600, .bg-green-50, [data-toast]");
  const errorMessages = await collectTexts(page, ".text-red-600, .bg-red-50, .text-rose-600");
  const permissions = compactText(
    [...buttons, ...headings, ...links].filter((value) => /upgrade|premium|permission|access denied|not allowed|admin only|restricted/i.test(value))
  );
  const relatedFeatures = compactText([...headings, ...buttons, ...links].filter((value) => /report|invoice|client|customer|payment|lead|settings|vendor|purchase|account|inventory|team/i.test(value)));
  const textSummary = compactText(await page.locator("main, body").evaluateAll((nodes) =>
    nodes.map((node) => (node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 4000))
  ))[0] || "";
  const domExcerpt = await page.content();
  const discoveredLinks = await discoverLinks(page, navigationPath.length, navigationPath);

  return {
    url: page.url(),
    path: currentPath,
    title,
    featureName: headings[0] || title || currentPath,
    navigationPath,
    headings,
    textSummary,
    buttons,
    tabs,
    accordions,
    modals,
    tables,
    filters,
    searches,
    cards,
    charts,
    forms,
    validationMessages,
    successMessages,
    errorMessages,
    permissions,
    relatedFeatures,
    safeActionsTried,
    consoleEvents: [],
    networkRequests: [],
    screenshotPath,
    domExcerpt: domExcerpt.slice(0, 15000),
    discoveredLinks,
    observedAt: new Date().toISOString()
  };
}

export async function performSafeInteractions(page: Page): Promise<UiAction[]> {
  const actions: UiAction[] = [];

  const buttonHandles = page.locator("button");
  const buttonCount = Math.min(await buttonHandles.count(), 20);

  for (let index = 0; index < buttonCount; index += 1) {
    const button = buttonHandles.nth(index);
    const label = (await button.textContent())?.trim() || `button-${index + 1}`;
    const safe = isSafeLabel(label);
    if (!safe) {
      actions.push({ type: "click", label, safe, reason: "blocked by safety policy" });
      continue;
    }

    const ariaExpanded = await button.getAttribute("aria-expanded");
    const isExpandable = ariaExpanded !== null || /more|details|filters|expand|view|show|open|tab/i.test(label);

    if (!isExpandable) {
      actions.push({ type: "click", label, safe, reason: "skipped because action looks stateful" });
      continue;
    }

    try {
      await button.click({ timeout: 1500 });
      actions.push({
        type: /tab/i.test(label) ? "select-tab" : "expand",
        label,
        safe
      });
      await page.waitForTimeout(250);
    } catch {
      actions.push({ type: "click", label, safe, reason: "click attempt failed" });
    }
  }

  return actions;
}

export async function fillFormsWithSampleData(page: Page): Promise<UiAction[]> {
  const actions: UiAction[] = [];
  const forms = page.locator("form");
  const formCount = await forms.count();

  for (let formIndex = 0; formIndex < formCount; formIndex += 1) {
    const form = forms.nth(formIndex);
    const inputs = form.locator("input, textarea, select");
    const inputCount = Math.min(await inputs.count(), 12);

    for (let index = 0; index < inputCount; index += 1) {
      const field = inputs.nth(index);
      const tagName = await field.evaluate((node) => node.tagName.toLowerCase());
      const type = (await field.getAttribute("type")) || tagName;
      const name = (await field.getAttribute("name")) || (await field.getAttribute("aria-label")) || `field-${index + 1}`;

      try {
        if (tagName === "select") {
          const options = await field.locator("option").evaluateAll((nodes) =>
            nodes.map((node) => (node as HTMLOptionElement).value).filter(Boolean)
          );
          if (options.length > 1) {
            await field.selectOption(options[1]);
            actions.push({ type: "fill", label: name, safe: true, reason: "selected test option" });
          }
          continue;
        }

        if (type === "checkbox" || type === "radio" || type === "file" || type === "hidden" || type === "password") {
          continue;
        }

        let value = "Test Value";
        if (type === "email") value = "agent@example.com";
        if (type === "number") value = "1";
        if (type === "tel") value = "9999999999";
        if (type === "date") value = "2026-01-01";

        await field.fill(value);
        actions.push({ type: "fill", label: name, safe: true, reason: `filled sample ${type}` });
      } catch {
        actions.push({ type: "fill", label: name, safe: false, reason: "sample fill failed" });
      }
    }
  }

  return actions;
}
