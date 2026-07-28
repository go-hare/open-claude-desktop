/**
 * Official Launch Preview CDP residual (app.asar class zFi / CDPTools):
 *
 *   attach(webContents): debugger.attach("1.3") + Console/Runtime/Network.enable
 *   setViewport(w,h,mobile?): Emulation.setDeviceMetricsOverride
 *   clearViewport(): Emulation.clearDeviceMetricsOverride
 *   setColorScheme(scheme): Emulation.setEmulatedMedia prefers-color-scheme
 *   enableInspectMode(cb): Overlay.setInspectMode searchForNode
 *   disableInspectMode()
 *   captureElementContext(backendNodeId) → elementSelected payload (ZFt shape)
 *
 * Product: used by LaunchPreviewViewManager for setPreviewViewport /
 * setPreviewColorScheme / clearPreviewViewport / toggleSelectionMode.
 */

import type { WebContents } from "electron";

export type PreviewElementContext = {
  tagName: string;
  id?: string;
  classes: string[];
  attributes: Record<string, string>;
  computedStyles: Record<string, string>;
  boundingBox: { x: number; y: number; width: number; height: number };
  screenshot: string;
  innerText?: string;
  parentPath?: string;
  action?: string;
  reactComponent?: string;
  reactProps?: Record<string, unknown>;
  sourceFile?: string;
  outerHTML?: string;
  siblingHTML?: string;
};

/** Official zFi console log residual. */
export type PreviewConsoleLog = {
  level: "log" | "info" | "warn" | "error" | "debug";
  text: string;
  timestamp: number;
  source?: string;
};

/** Official zFi network entry residual. */
export type PreviewNetworkEntry = {
  requestId: string;
  url: string;
  method: string;
  resourceType?: string;
  timestamp: number;
  status?: number;
  statusText?: string;
  failed?: boolean;
  errorText?: string;
};

/** Official Accessibility tree node residual (takeSnapshot). */
export type PreviewAxNode = {
  uid: string;
  role: string;
  name: string;
  value?: string;
  description?: string;
  children: PreviewAxNode[];
};

/** Official $Fi — interactive roles kept when pruning snapshot text. */
const INTERACTIVE_AX_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "checkbox",
  "radio",
  "combobox",
  "menuitem",
  "tab",
  "heading",
  "img",
]);

/** Official WFi — structural roles that may collapse. */
const STRUCTURAL_AX_ROLES = new Set(["none", "presentation", "generic"]);

const DEFAULT_INSPECT_STYLES = [
  "color",
  "background-color",
  "font-size",
  "font-weight",
  "padding",
  "margin",
  "width",
  "height",
  "display",
  "visibility",
] as const;

const MAX_CDP_LOGS = 500;
const SNAPSHOT_TEXT_MAX = 12_000;

const ELEMENT_STYLE_PROPS = [
  "display",
  "position",
  "flexDirection",
  "justifyContent",
  "alignItems",
  "width",
  "height",
  "padding",
  "margin",
  "backgroundColor",
  "color",
  "fontSize",
  "fontWeight",
  "borderRadius",
  "border",
] as const;

const ATTR_KEYS = [
  "data-testid",
  "data-test-id",
  "aria-label",
  "name",
  "type",
  "href",
  "role",
  "placeholder",
  "title",
  "alt",
  "onclick",
  "value",
  "src",
] as const;

const HIGHLIGHT_CONFIG = {
  showInfo: true,
  contentColor: { r: 111, g: 168, b: 220, a: 0.66 },
  paddingColor: { r: 147, g: 196, b: 125, a: 0.55 },
  borderColor: { r: 255, g: 229, b: 153, a: 0.66 },
  marginColor: { r: 246, g: 178, b: 107, a: 0.66 },
};

const SCREENSHOT_PADDING = 80;
const SCREENSHOT_MAX = 1200;

type DebuggerLike = {
  isAttached: () => boolean;
  attach: (protocolVersion: string) => void;
  detach: () => void;
  sendCommand: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  on: (event: "message", listener: (event: unknown, method: string, params: unknown) => void) => void;
  off: (event: "message", listener: (event: unknown, method: string, params: unknown) => void) => void;
};

function getDebugger(wc: WebContents): DebuggerLike {
  return (wc as WebContents & { debugger: DebuggerLike }).debugger;
}

export class LaunchPreviewCdp {
  private webContents: WebContents | null = null;
  private attached = false;
  private inspectModeCallback: ((backendNodeId: number) => void) | null = null;
  private boundMessageHandler:
    | ((event: unknown, method: string, params: unknown) => void)
    | null = null;
  /** Official residual — scale applied by setViewport(…, scale). */
  emulationScale = 1;
  /** Official zFi consoleLogs residual. */
  private consoleLogs: PreviewConsoleLog[] = [];
  /** Official zFi networkEntries residual. */
  private networkEntries = new Map<string, PreviewNetworkEntry>();
  /** Official zFi uidCounter residual for AX snapshot. */
  private uidCounter = 0;

  isAttached(): boolean {
    return this.attached;
  }

  async attach(webContents: WebContents): Promise<void> {
    if (this.attached && this.webContents === webContents) return;
    this.detach();
    this.webContents = webContents;
    this.emulationScale = 1;
    this.consoleLogs = [];
    this.networkEntries = new Map();
    this.uidCounter = 0;
    const dbg = getDebugger(webContents);
    if (!dbg.isAttached()) dbg.attach("1.3");
    await dbg.sendCommand("Console.enable");
    await dbg.sendCommand("Runtime.enable");
    await dbg.sendCommand("Network.enable");
    this.boundMessageHandler = (_event, method, params) => {
      this.handleDebuggerMessage(method, params);
    };
    dbg.on("message", this.boundMessageHandler);
    this.attached = true;
  }

  detach(): void {
    if (this.webContents && !this.webContents.isDestroyed()) {
      const dbg = getDebugger(this.webContents);
      if (this.boundMessageHandler) {
        try {
          dbg.off("message", this.boundMessageHandler);
        } catch {
          /* ignore */
        }
      }
      if (dbg.isAttached()) {
        try {
          void dbg.sendCommand("Network.disable").catch(() => undefined);
        } catch {
          /* ignore */
        }
        try {
          dbg.detach();
        } catch {
          /* ignore */
        }
      }
    }
    this.boundMessageHandler = null;
    this.inspectModeCallback = null;
    this.attached = false;
    this.webContents = null;
    this.emulationScale = 1;
    this.consoleLogs = [];
    this.networkEntries = new Map();
    this.uidCounter = 0;
  }

  private ensureAttached(): void {
    if (!this.webContents || !this.attached || this.webContents.isDestroyed()) {
      throw new Error("CDP not attached. Call attach() first.");
    }
  }

  private async sendCommand(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    this.ensureAttached();
    return getDebugger(this.webContents!).sendCommand(method, params);
  }

  private normalizeLogLevel(
    level: string | undefined,
  ): PreviewConsoleLog["level"] {
    switch (level) {
      case "warning":
      case "warn":
        return "warn";
      case "error":
        return "error";
      case "info":
        return "info";
      case "debug":
      case "verbose":
        return "debug";
      default:
        return "log";
    }
  }

  private addConsoleLog(entry: PreviewConsoleLog): void {
    this.consoleLogs.push(entry);
    if (this.consoleLogs.length > MAX_CDP_LOGS) this.consoleLogs.shift();
  }

  private handleDebuggerMessage(method: string, params: unknown): void {
    const p = (params ?? {}) as Record<string, unknown>;
    if (method === "Console.messageAdded") {
      const message = (p.message ?? {}) as Record<string, unknown>;
      this.addConsoleLog({
        level: this.normalizeLogLevel(
          typeof message.level === "string" ? message.level : undefined,
        ),
        text: typeof message.text === "string" ? message.text : "",
        timestamp:
          typeof message.timestamp === "number" ? message.timestamp : Date.now(),
        source: typeof message.source === "string" ? message.source : undefined,
      });
      return;
    }
    if (method === "Runtime.consoleAPICalled") {
      const args = Array.isArray(p.args) ? p.args : [];
      const text = args
        .map((arg) => {
          const rec = arg as Record<string, unknown>;
          if (typeof rec.value === "string") return rec.value;
          if (typeof rec.description === "string") return rec.description;
          if (rec.value !== undefined) return String(rec.value);
          return "";
        })
        .join(" ");
      this.addConsoleLog({
        level: this.normalizeLogLevel(
          typeof p.type === "string" ? p.type : undefined,
        ),
        text,
        timestamp: typeof p.timestamp === "number" ? p.timestamp : Date.now(),
      });
      return;
    }
    if (method === "Network.requestWillBeSent") {
      const requestId = typeof p.requestId === "string" ? p.requestId : "";
      const request = (p.request ?? {}) as Record<string, unknown>;
      if (!requestId) return;
      this.networkEntries.set(requestId, {
        requestId,
        url: typeof request.url === "string" ? request.url : "",
        method: typeof request.method === "string" ? request.method : "GET",
        resourceType: typeof p.type === "string" ? p.type : "Other",
        timestamp: typeof p.timestamp === "number" ? p.timestamp : Date.now(),
      });
      if (this.networkEntries.size > MAX_CDP_LOGS) {
        const first = this.networkEntries.keys().next().value;
        if (first) this.networkEntries.delete(first);
      }
      return;
    }
    if (method === "Network.responseReceived") {
      const requestId = typeof p.requestId === "string" ? p.requestId : "";
      const response = (p.response ?? {}) as Record<string, unknown>;
      const entry = this.networkEntries.get(requestId);
      if (entry) {
        if (typeof response.status === "number") entry.status = response.status;
        if (typeof response.statusText === "string") {
          entry.statusText = response.statusText;
        }
      }
      return;
    }
    if (method === "Network.loadingFailed") {
      const requestId = typeof p.requestId === "string" ? p.requestId : "";
      const entry = this.networkEntries.get(requestId);
      if (entry) {
        entry.failed = true;
        if (typeof p.errorText === "string") entry.errorText = p.errorText;
      }
      return;
    }
    if (method === "Overlay.inspectNodeRequested") {
      const backendNodeId = (p as { backendNodeId?: number }).backendNodeId;
      if (this.inspectModeCallback && typeof backendNodeId === "number") {
        this.inspectModeCallback(backendNodeId);
      }
    }
  }

  /** Official getConsoleLogs residual. */
  getConsoleLogs(
    level?: "all" | "error" | "warn",
  ): PreviewConsoleLog[] {
    if (!level || level === "all") return [...this.consoleLogs];
    if (level === "error") {
      return this.consoleLogs.filter((item) => item.level === "error");
    }
    if (level === "warn") {
      return this.consoleLogs.filter(
        (item) => item.level === "warn" || item.level === "error",
      );
    }
    return [...this.consoleLogs];
  }

  /** Official getNetworkEntries residual. */
  getNetworkEntries(filter?: "all" | "failed"): PreviewNetworkEntry[] {
    const all = [...this.networkEntries.values()];
    if (filter === "failed") {
      return all.filter(
        (item) =>
          item.failed === true
          || (item.status !== undefined && item.status >= 400),
      );
    }
    return all;
  }

  /** Official getResponseBody residual. */
  async getResponseBody(
    requestId: string,
  ): Promise<{ body: string; base64Encoded: boolean } | null> {
    this.ensureAttached();
    try {
      const result = (await this.sendCommand("Network.getResponseBody", {
        requestId,
      })) as { body?: string; base64Encoded?: boolean };
      if (typeof result?.body !== "string") return null;
      return {
        body: result.body,
        base64Encoded: result.base64Encoded === true,
      };
    } catch {
      return null;
    }
  }

  /**
   * Official setViewport residual:
   * Emulation.setDeviceMetricsOverride({ width, height, deviceScaleFactor: mobile?2:1, mobile: mobile??w<768, scale? })
   */
  async setViewport(
    width: number,
    height: number,
    mobile?: boolean,
    scale?: number,
  ): Promise<void> {
    this.ensureAttached();
    const isMobile = mobile ?? width < 768;
    await this.sendCommand("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: isMobile ? 2 : 1,
      mobile: isMobile,
      ...(scale !== undefined ? { scale } : {}),
    });
    this.emulationScale = scale ?? 1;
  }

  async clearViewport(): Promise<void> {
    this.ensureAttached();
    await this.sendCommand("Emulation.clearDeviceMetricsOverride");
    this.emulationScale = 1;
  }

  /**
   * Official setColorScheme residual:
   * Emulation.setEmulatedMedia({ features: [{ name: "prefers-color-scheme", value }] })
   */
  async setColorScheme(scheme: "light" | "dark"): Promise<void> {
    this.ensureAttached();
    await this.sendCommand("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: scheme }],
    });
  }

  async enableInspectMode(
    callback: (backendNodeId: number) => void,
  ): Promise<void> {
    this.ensureAttached();
    this.inspectModeCallback = callback;
    await this.sendCommand("DOM.enable");
    await this.sendCommand("Overlay.enable");
    await this.sendCommand("Overlay.setInspectMode", {
      mode: "searchForNode",
      highlightConfig: HIGHLIGHT_CONFIG,
    });
  }

  async disableInspectMode(): Promise<void> {
    this.ensureAttached();
    this.inspectModeCallback = null;
    try {
      await this.sendCommand("Overlay.hideHighlight");
      await this.sendCommand("Overlay.setInspectMode", {
        mode: "none",
        highlightConfig: {},
      });
      await this.sendCommand("Overlay.disable");
      await this.sendCommand("DOM.disable");
    } catch {
      /* best-effort */
    }
  }

  /**
   * Official takeScreenshot residual — webContents.capturePage → PNG base64.
   */
  async takeScreenshot(): Promise<string> {
    this.ensureAttached();
    const wc = this.webContents!;
    const image = await wc.capturePage();
    return image.toPNG().toString("base64");
  }

  /**
   * Official takeScreenshotViaCDP residual — Page.captureScreenshot format png.
   */
  async takeScreenshotViaCDP(): Promise<string> {
    this.ensureAttached();
    const result = (await this.sendCommand("Page.captureScreenshot", {
      format: "png",
    })) as { data?: string };
    if (!result?.data) throw new Error("CDP screenshot empty");
    return result.data;
  }

  /**
   * Official captureElementContext residual → ZFt elementSelected payload.
   * Screenshot uses capturePage clip with SCREENSHOT_PADDING (not invent).
   */
  async captureElementContext(
    backendNodeId: number,
  ): Promise<PreviewElementContext | null> {
    this.ensureAttached();
    try {
      await this.sendCommand("DOM.enable");
      await this.sendCommand("CSS.enable");
      await this.sendCommand("DOM.getDocument", { depth: 0 });
      const described = (await this.sendCommand("DOM.describeNode", {
        backendNodeId,
        depth: 0,
      })) as { node?: { nodeId?: number; nodeName?: string; attributes?: string[] } };
      const node = described.node;
      if (!node?.nodeId) return null;
      const nodeId = node.nodeId;
      const rawAttrs = node.attributes ?? [];
      const attrMap: Record<string, string> = {};
      for (let i = 0; i < rawAttrs.length; i += 2) {
        attrMap[rawAttrs[i]!] = rawAttrs[i + 1] ?? "";
      }
      const className = attrMap.class ?? "";
      const id = attrMap.id || undefined;
      const classes = className ? className.split(/\s+/).filter(Boolean) : [];
      const attributes: Record<string, string> = {};
      for (const key of ATTR_KEYS) {
        if (attrMap[key]) attributes[key] = attrMap[key]!;
      }
      let action: string | undefined;
      if (attrMap.href) action = `navigates to: ${attrMap.href}`;
      else if (attrMap.onclick) action = `onclick: ${attrMap.onclick.slice(0, 100)}`;

      const computedStyles: Record<string, string> = {};
      try {
        const styleResult = (await this.sendCommand("CSS.getComputedStyleForNode", {
          nodeId,
        })) as { computedStyle?: Array<{ name: string; value: string }> };
        const computed = styleResult.computedStyle ?? [];
        for (const prop of ELEMENT_STYLE_PROPS) {
          const hit = computed.find((item) => item.name === prop);
          if (hit) computedStyles[prop] = hit.value;
        }
      } catch {
        /* soft */
      }

      let boundingBox = { x: 0, y: 0, width: 0, height: 0 };
      try {
        const box = (await this.sendCommand("DOM.getBoxModel", {
          backendNodeId,
        })) as { model?: { content?: number[] } };
        const content = box.model?.content;
        if (content && content.length >= 6) {
          boundingBox = {
            x: content[0]!,
            y: content[1]!,
            width: content[2]! - content[0]!,
            height: content[5]! - content[1]!,
          };
        }
      } catch {
        /* soft */
      }

      let objectId: string | undefined;
      try {
        const resolved = (await this.sendCommand("DOM.resolveNode", {
          backendNodeId,
        })) as { object?: { objectId?: string } };
        objectId = resolved.object?.objectId;
      } catch {
        /* soft */
      }

      let reactComponent: string | undefined;
      let reactProps: Record<string, unknown> | undefined;
      let sourceFile: string | undefined;
      let innerText: string | undefined;
      let parentPath: string | undefined;
      let outerHTML: string | undefined;
      let siblingHTML: string | undefined;

      if (objectId) {
        try {
          const fiber = (await this.sendCommand("Runtime.callFunctionOn", {
            objectId,
            functionDeclaration: `function() {
              var key = Object.keys(this).find(function(k) {
                return k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$');
              });
              if (!key) return null;
              var fiber = this[key];
              function isUsefulName(n) {
                return n && n.length > 1 && n !== 'Anonymous';
              }
              while (fiber && (!fiber.type || typeof fiber.type === 'string' || !isUsefulName(fiber.type.displayName || fiber.type.name))) {
                fiber = fiber.return;
              }
              if (!fiber || !fiber.type) return null;
              var name = fiber.type.displayName || fiber.type.name || null;
              if (!name) return null;
              var ancestors = [];
              var parent = fiber.return;
              for (var i = 0; i < 4 && parent; parent = parent.return) {
                if (parent.type && typeof parent.type !== 'string') {
                  var pn = parent.type.displayName || parent.type.name;
                  if (isUsefulName(pn)) {
                    ancestors.push(pn);
                    i++;
                  }
                }
              }
              var source = null;
              try {
                var src = fiber._debugSource;
                if (src && src.fileName) {
                  source = src.fileName;
                  if (src.lineNumber) source += ':' + src.lineNumber;
                }
              } catch (e) {}
              var props = {};
              try {
                var mp = fiber.memoizedProps || {};
                Object.keys(mp).forEach(function(k) {
                  if (k === 'children') return;
                  var v = mp[k];
                  var t = typeof v;
                  if (t === 'string' || t === 'number' || t === 'boolean' || v === null) {
                    props[k] = v;
                  } else if (t === 'function') {
                    props[k] = '[function]';
                  } else if (Array.isArray(v)) {
                    props[k] = '[array(' + v.length + ')]';
                  } else if (t === 'object') {
                    props[k] = '[object]';
                  }
                });
              } catch (e) {}
              return { name: name, props: props, ancestors: ancestors, source: source };
            }`,
            returnByValue: true,
          })) as { result?: { value?: { name?: string; props?: Record<string, unknown>; ancestors?: string[]; source?: string | null } } };
          const value = fiber.result?.value;
          if (value?.name) {
            reactComponent =
              value.ancestors && value.ancestors.length > 0
                ? `${value.name} (in ${value.ancestors.join(" > ")})`
                : value.name;
            if (value.source) sourceFile = value.source;
            reactProps = value.props;
          }
        } catch {
          /* soft */
        }

        try {
          const textResult = (await this.sendCommand("Runtime.callFunctionOn", {
            objectId,
            functionDeclaration:
              "function() { return this.innerText?.substring(0, 200) || ''; }",
            returnByValue: true,
          })) as { result?: { value?: string } };
          innerText = textResult.result?.value || undefined;
        } catch {
          /* soft */
        }

        try {
          const pathResult = (await this.sendCommand("Runtime.callFunctionOn", {
            objectId,
            functionDeclaration: `function() {
              const parts = [];
              let el = this.parentElement;
              for (let i = 0; i < 4 && el && el !== document.body; i++) {
                let selector = el.tagName.toLowerCase();
                if (el.id) selector += '#' + el.id;
                else if (el.getAttribute('class')) selector += '.' + el.getAttribute('class').split(' ')[0];
                parts.unshift(selector);
                el = el.parentElement;
              }
              return parts.join(' > ');
            }`,
            returnByValue: true,
          })) as { result?: { value?: string } };
          parentPath = pathResult.result?.value || undefined;
        } catch {
          /* soft */
        }

        try {
          const htmlResult = (await this.sendCommand("Runtime.callFunctionOn", {
            objectId,
            functionDeclaration: `function() {
              var outer = this.outerHTML;
              if (outer && outer.length > 2000) {
                outer = outer.substring(0, 2000) + '...';
              }
              var sibling = null;
              if (this.parentElement) {
                var children = Array.from(this.parentElement.children);
                var parts = children.map(function(child) {
                  if (child === this) return '<!-- SELECTED -->' + child.outerHTML;
                  var tag = child.tagName.toLowerCase();
                  var rawCls = child.getAttribute('class') || '';
                  var cls = rawCls ? ' class="' + rawCls.split(' ').slice(0, 3).join(' ') + '"' : '';
                  var id = child.id ? ' id="' + child.id + '"' : '';
                  return '<' + tag + id + cls + ' />';
                }.bind(this));
                sibling = parts.join('\\n');
                if (sibling.length > 2000) sibling = sibling.substring(0, 2000) + '...';
              }
              return { outer: outer, sibling: sibling };
            }`,
            returnByValue: true,
          })) as { result?: { value?: { outer?: string; sibling?: string | null } } };
          const html = htmlResult.result?.value;
          if (html?.outer) outerHTML = html.outer;
          if (html?.sibling) siblingHTML = html.sibling;
        } catch {
          /* soft */
        }
      }

      let screenshot = "";
      try {
        const wc = this.webContents!;
        if (
          boundingBox.width > 0 &&
          boundingBox.height > 0 &&
          boundingBox.x >= 0 &&
          boundingBox.y >= 0
        ) {
          const scrollRaw = (await this.sendCommand("Runtime.evaluate", {
            expression:
              "JSON.stringify({ x: window.scrollX, y: window.scrollY })",
            returnByValue: true,
          })) as { result?: { value?: string } };
          const scroll = JSON.parse(scrollRaw.result?.value ?? '{"x":0,"y":0}') as {
            x: number;
            y: number;
          };
          const scale = this.emulationScale;
          const pad = SCREENSHOT_PADDING;
          const clipX = Math.max(0, (boundingBox.x - scroll.x) * scale - pad);
          const clipY = Math.max(0, (boundingBox.y - scroll.y) * scale - pad);
          const clipW = boundingBox.width * scale + pad * 2;
          const clipH = boundingBox.height * scale + pad * 2;
          let image = await wc.capturePage({
            x: Math.round(clipX),
            y: Math.round(clipY),
            width: Math.round(clipW),
            height: Math.round(clipH),
          });
          const size = image.getSize();
          if (size.width > SCREENSHOT_MAX || size.height > SCREENSHOT_MAX) {
            const q = Math.min(
              SCREENSHOT_MAX / size.width,
              SCREENSHOT_MAX / size.height,
            );
            image = image.resize({
              width: Math.round(size.width * q),
              height: Math.round(size.height * q),
            });
          }
          screenshot = image.toPNG().toString("base64");
        } else {
          screenshot = (await wc.capturePage()).toPNG().toString("base64");
        }
      } catch {
        /* soft — screenshot required by ZFt; empty string if capture fails */
      }

      return {
        tagName: (node.nodeName ?? "div").toLowerCase(),
        id,
        classes,
        attributes,
        computedStyles,
        boundingBox,
        screenshot,
        innerText,
        parentPath,
        action,
        reactComponent,
        reactProps,
        sourceFile,
        outerHTML,
        siblingHTML,
      };
    } catch {
      return null;
    } finally {
      try {
        await this.sendCommand("CSS.disable");
        await this.sendCommand("DOM.disable");
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * Official captureViaCDP residual — Page.captureScreenshot with optional jpeg clip.
   */
  private async captureViaCDP(
    format: "png" | "jpeg",
    compress = false,
  ): Promise<string> {
    this.ensureAttached();
    let clearedViewport = false;
    try {
      const metrics = (await this.sendCommand("Page.getLayoutMetrics")) as {
        cssVisualViewport?: { clientWidth?: number; clientHeight?: number };
      };
      let viewport = metrics.cssVisualViewport;
      if (!(viewport?.clientWidth) || !(viewport?.clientHeight)) {
        await this.setViewport(1280, 720);
        clearedViewport = true;
        const next = (await this.sendCommand("Page.getLayoutMetrics")) as {
          cssVisualViewport?: { clientWidth?: number; clientHeight?: number };
        };
        viewport = next.cssVisualViewport;
      }
      const width = viewport?.clientWidth ?? 1280;
      const height = viewport?.clientHeight ?? 720;
      const maxW = 800;
      const clip =
        compress && width > maxW
          ? { x: 0, y: 0, width, height, scale: maxW / width }
          : undefined;
      const result = (await this.sendCommand("Page.captureScreenshot", {
        format,
        ...(format === "jpeg" ? { quality: 75 } : {}),
        ...(clip ? { clip } : {}),
      })) as { data?: string };
      if (!result?.data) throw new Error("CDP screenshot empty");
      return result.data;
    } finally {
      if (clearedViewport) {
        await this.clearViewport().catch(() => undefined);
      }
    }
  }

  /**
   * Official takeScreenshotCompressed residual — capturePage → JPEG max width 800.
   */
  async takeScreenshotCompressed(): Promise<string> {
    this.ensureAttached();
    const wc = this.webContents!;
    const image = await wc.capturePage();
    const size = image.getSize();
    if (size.width === 0 || size.height === 0) {
      return image.toJPEG(75).toString("base64");
    }
    const width = Math.min(size.width, 800);
    const height = Math.floor((width / size.width) * size.height);
    return image
      .resize({ width, height, quality: "good" })
      .toJPEG(75)
      .toString("base64");
  }

  /** Official takeScreenshotViaCDPCompressed residual. */
  async takeScreenshotViaCDPCompressed(): Promise<string> {
    return this.captureViaCDP("jpeg", true);
  }

  /** Official Runtime.evaluate residual. */
  async evaluate(expression: string): Promise<unknown> {
    this.ensureAttached();
    const result = (await this.sendCommand("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      timeout: 30_000,
    })) as {
      exceptionDetails?: {
        text?: string;
        exception?: { description?: string };
      };
      result?: { value?: unknown };
    };
    const exception = result.exceptionDetails;
    if (exception) {
      const message =
        exception.exception?.description
        ?? exception.text
        ?? "Evaluation failed";
      throw new Error(message);
    }
    return result.result?.value;
  }

  /**
   * Official clickAt residual — Input.dispatchMouseEvent press/release.
   */
  async clickAt(
    x: number,
    y: number,
    options?: { doubleClick?: boolean },
  ): Promise<boolean> {
    this.ensureAttached();
    try {
      const count = options?.doubleClick ? 2 : 1;
      for (let i = 0; i < count; i += 1) {
        await this.sendCommand("Input.dispatchMouseEvent", {
          type: "mousePressed",
          x,
          y,
          button: "left",
          clickCount: 1,
        });
        await this.sendCommand("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x,
          y,
          button: "left",
          clickCount: 1,
        });
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Official click(selector) residual — scrollIntoView + center + clickAt.
   */
  async click(
    selector: string,
    options?: { doubleClick?: boolean },
  ): Promise<boolean> {
    this.ensureAttached();
    try {
      const exists = await this.evaluate(
        `!!document.querySelector(${JSON.stringify(selector)})`,
      );
      if (!exists) return false;
      const rect = (await this.evaluate(`
        (function() {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return null;
          el.scrollIntoView({ block: 'center', behavior: 'instant' });
          const r = el.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        })()
      `)) as { x: number; y: number } | null;
      if (!rect) return false;
      return this.clickAt(rect.x, rect.y, options);
    } catch {
      return false;
    }
  }

  /**
   * Official fill residual — native value setter + input/change events.
   */
  async fill(selector: string, value: string): Promise<boolean> {
    this.ensureAttached();
    try {
      const result = (await this.evaluate(`
        (function() {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return { success: false, error: 'Element not found' };
          el.focus();
          const tagName = el.tagName.toLowerCase();
          if (tagName === 'select') {
            const option = Array.from(el.options).find(o =>
              o.value === ${JSON.stringify(value)} || o.text === ${JSON.stringify(value)}
            );
            if (option) {
              el.value = option.value;
            } else {
              return { success: false, error: 'Option not found' };
            }
          } else if (tagName === 'input' || tagName === 'textarea') {
            const proto = tagName === 'textarea'
              ? window.HTMLTextAreaElement.prototype
              : window.HTMLInputElement.prototype;
            const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (nativeSetter) {
              nativeSetter.call(el, ${JSON.stringify(value)});
            } else {
              el.value = ${JSON.stringify(value)};
            }
          } else if (el.isContentEditable) {
            el.textContent = ${JSON.stringify(value)};
          } else {
            return { success: false, error: 'Element is not fillable' };
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { success: true };
        })()
      `)) as { success?: boolean };
      return result?.success === true;
    } catch {
      return false;
    }
  }

  /**
   * Official inspectElement residual — DOM.querySelector + computed styles.
   */
  async inspectElement(
    selector: string,
    styles?: string[],
  ): Promise<Record<string, unknown> | null> {
    this.ensureAttached();
    try {
      await this.sendCommand("DOM.enable");
      await this.sendCommand("CSS.enable");
      const doc = (await this.sendCommand("DOM.getDocument")) as {
        root?: { nodeId?: number };
      };
      const rootId = doc.root?.nodeId;
      if (typeof rootId !== "number") return null;
      const queried = (await this.sendCommand("DOM.querySelector", {
        nodeId: rootId,
        selector,
      })) as { nodeId?: number };
      const nodeId = queried.nodeId;
      if (!nodeId) return null;
      const described = (await this.sendCommand("DOM.describeNode", {
        nodeId,
      })) as {
        node?: {
          nodeName?: string;
          attributes?: string[];
        };
      };
      const node = described.node;
      const attrs = node?.attributes ?? [];
      let className = "";
      let id = "";
      let value = "";
      for (let i = 0; i < attrs.length; i += 2) {
        if (attrs[i] === "class") className = (attrs[i + 1] ?? "").slice(0, 200);
        if (attrs[i] === "id") id = attrs[i + 1] ?? "";
        if (attrs[i] === "value") value = attrs[i + 1] ?? "";
      }
      const styleNames = styles?.length
        ? styles
        : [...DEFAULT_INSPECT_STYLES];
      const computedResult = (await this.sendCommand(
        "CSS.getComputedStyleForNode",
        { nodeId },
      )) as { computedStyle?: Array<{ name: string; value: string }> };
      const computed: Record<string, string> = {};
      const list = computedResult.computedStyle ?? [];
      for (const name of styleNames) {
        const hit = list.find((item) => item.name === name);
        if (hit) computed[name] = hit.value;
      }
      let boundingBox: { x: number; y: number; width: number; height: number } | undefined;
      try {
        const box = (await this.sendCommand("DOM.getBoxModel", {
          nodeId,
        })) as { model?: { content?: number[] } };
        const content = box.model?.content;
        if (content && content.length >= 6) {
          boundingBox = {
            x: content[0]!,
            y: content[1]!,
            width: content[2]! - content[0]!,
            height: content[5]! - content[1]!,
          };
        }
      } catch {
        /* soft */
      }
      const innerText =
        ((await this.evaluate(
          `document.querySelector(${JSON.stringify(selector)})?.innerText?.substring(0, 500) || ""`,
        )) as string) || "";
      return {
        tagName: (node?.nodeName ?? "").toLowerCase(),
        id: id || undefined,
        className: className || undefined,
        value: value || undefined,
        innerText,
        computedStyles: computed,
        boundingBox,
      };
    } catch {
      return null;
    }
  }

  /**
   * Official takeSnapshot residual — Accessibility.getFullAXTree → tree with uids.
   */
  async takeSnapshot(): Promise<PreviewAxNode | null> {
    this.ensureAttached();
    try {
      const result = (await this.sendCommand(
        "Accessibility.getFullAXTree",
      )) as {
        nodes?: Array<{
          nodeId: string | number;
          role?: { value?: string };
          name?: { value?: string };
          value?: { value?: unknown };
          description?: { value?: string };
          childIds?: Array<string | number>;
        }>;
      };
      const nodes = result.nodes;
      if (!nodes || nodes.length === 0) return null;
      const byId = new Map<string | number, (typeof nodes)[number]>();
      for (const node of nodes) byId.set(node.nodeId, node);
      const build = (
        node: (typeof nodes)[number],
      ): PreviewAxNode => {
        const children: PreviewAxNode[] = [];
        if (node.childIds) {
          for (const childId of node.childIds) {
            const child = byId.get(childId);
            if (child) children.push(build(child));
          }
        }
        const valueRaw = node.value?.value;
        return {
          uid: `${++this.uidCounter}`,
          role: node.role?.value || "unknown",
          name: node.name?.value || "",
          value: valueRaw != null ? String(valueRaw) : undefined,
          description: node.description?.value,
          children,
        };
      };
      return build(nodes[0]!);
    } catch {
      return null;
    }
  }

  /**
   * Official formatSnapshotAsText residual (depth cap 8, collapse structural roles).
   */
  formatSnapshotAsText(
    node: PreviewAxNode,
    indent = 0,
    depth = 0,
  ): string {
    const truncate = (text: string, max: number) =>
      text.length <= max ? text : `${text.slice(0, max)}...`;
    const countDescendants = (n: PreviewAxNode): number => {
      let total = n.children.length;
      for (const child of n.children) total += countDescendants(child);
      return total;
    };
    const hasInteractive = (n: PreviewAxNode): boolean => {
      for (const child of n.children) {
        if (
          (INTERACTIVE_AX_ROLES.has(child.role)
            && !(child.role === "img" && !child.name))
          || hasInteractive(child)
        ) {
          return true;
        }
      }
      return false;
    };
    const isStructuralOnly = (n: PreviewAxNode): boolean =>
      STRUCTURAL_AX_ROLES.has(n.role) && !n.name && !n.value && !hasInteractive(n);

    if (depth > 8) {
      const pad = "  ".repeat(indent);
      const name = node.name ? truncate(node.name, 200) : "";
      const value = node.value ? truncate(node.value, 200) : "";
      let line = `${pad}[${node.uid}] ${node.role}`;
      if (name) line += `: "${name}"`;
      if (value) line += ` (value: "${value}")`;
      const descendants = countDescendants(node);
      if (descendants > 0) line += ` ... (${descendants} descendants)`;
      return line;
    }

    const children =
      node.role === "SvgRoot"
      || (node.role === "img" && node.children.length > 0 && !hasInteractive(node))
        ? []
        : node.children;

    if (isStructuralOnly(node)) {
      const parts: string[] = [];
      for (const child of children) {
        const text = this.formatSnapshotAsText(child, indent, depth);
        if (text) parts.push(text);
      }
      return parts.join("\n");
    }

    if (
      !node.name
      && !node.value
      && children.length === 1
      && STRUCTURAL_AX_ROLES.has(node.role)
    ) {
      return this.formatSnapshotAsText(children[0]!, indent, depth);
    }

    const pad = "  ".repeat(indent);
    const name = node.name ? truncate(node.name, 200) : "";
    const value = node.value ? truncate(node.value, 200) : "";
    let line = `${pad}[${node.uid}] ${node.role}`;
    if (name) line += `: "${name}"`;
    if (value) line += ` (value: "${value}")`;
    const lines = [line];
    for (const child of children) {
      const text = this.formatSnapshotAsText(child, indent + 1, depth + 1);
      if (text) lines.push(text);
    }
    return lines.join("\n");
  }

  /** Official mOi residual helper — snapshot text capped at 12k. */
  async takeSnapshotText(): Promise<string | null> {
    const tree = await this.takeSnapshot();
    if (!tree) return null;
    const text = this.formatSnapshotAsText(tree);
    if (text.length <= SNAPSHOT_TEXT_MAX) return text;
    return (
      `${text.slice(0, SNAPSHOT_TEXT_MAX)}\n\n`
      + `... (truncated — ${text.length} total chars, showing first ${SNAPSHOT_TEXT_MAX})`
    );
  }
}
