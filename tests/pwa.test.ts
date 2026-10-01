import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { registerServiceWorker } from "../src/scripts/sw-register.ts";

const ROOT_DIR = path.resolve(import.meta.dirname, "..");
const MANIFEST_PATH = path.join(ROOT_DIR, "public", "manifest.json");
const SW_PATH = path.join(ROOT_DIR, "public", "sw.js");
const ICONS_DIR = path.join(ROOT_DIR, "public", "icons");
const LAYOUT_PATH = path.join(ROOT_DIR, "src", "layouts", "Layout.astro");

describe("PWA Web App Manifest (Scenario 1)", () => {
  it("manifest.json exists and contains standalone configuration and required fields", () => {
    assert.strictEqual(fs.existsSync(MANIFEST_PATH), true, "manifest.json must exist in public/");
    const content = fs.readFileSync(MANIFEST_PATH, "utf-8");
    const manifest = JSON.parse(content) as Record<string, unknown>;

    assert.strictEqual(manifest.name, "SnapTally");
    assert.strictEqual(manifest.short_name, "SnapTally");
    assert.strictEqual(manifest.start_url, "/");
    assert.strictEqual(manifest.display, "standalone");
    assert.strictEqual(manifest.orientation, "portrait");
    assert.strictEqual(typeof manifest.theme_color, "string");
    assert.strictEqual(typeof manifest.background_color, "string");

    assert.strictEqual(Array.isArray(manifest.icons), true);
    const icons = manifest.icons as Array<{
      src: string;
      sizes: string;
      type: string;
      purpose?: string;
    }>;
    assert.ok(icons.length >= 3, "manifest must define at least 3 icon variants");

    const has192 = icons.some((i) => i.sizes === "192x192" && i.src.includes("192"));
    const has512 = icons.some((i) => i.sizes === "512x512" && i.src.includes("512"));
    const hasMaskable = icons.some((i) => i.purpose?.includes("maskable"));

    assert.strictEqual(has192, true, "manifest must define 192x192 icon");
    assert.strictEqual(has512, true, "manifest must define 512x512 icon");
    assert.strictEqual(hasMaskable, true, "manifest must define maskable icon");

    // Verify all icon paths exist
    for (const icon of icons) {
      const cleanPath = icon.src.startsWith("/") ? icon.src.slice(1) : icon.src;
      const fullPath = path.join(ROOT_DIR, "public", cleanPath);
      assert.strictEqual(
        fs.existsSync(fullPath),
        true,
        `Icon file ${icon.src} must exist at ${fullPath}`,
      );
    }
  });
});

describe("PWA App Icon Assets", () => {
  const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  it("contains valid PNG and SVG icons with valid binary signatures", () => {
    const requiredIcons = [
      "icon-192.png",
      "icon-512.png",
      "icon-maskable-192.png",
      "icon-maskable-512.png",
      "apple-touch-icon.png",
      "icon.svg",
    ];

    for (const file of requiredIcons) {
      const filePath = path.join(ICONS_DIR, file);
      assert.strictEqual(fs.existsSync(filePath), true, `${file} must exist in public/icons/`);
      const stat = fs.statSync(filePath);
      assert.ok(stat.size > 0, `${file} must not be empty`);

      if (file.endsWith(".png")) {
        const buf = Buffer.alloc(8);
        const fd = fs.openSync(filePath, "r");
        fs.readSync(fd, buf, 0, 8, 0);
        fs.closeSync(fd);
        assert.deepStrictEqual(buf, PNG_HEADER, `${file} must have valid PNG magic signature`);
      }
    }
  });
});

describe("PWA Service Worker (Scenario 2)", () => {
  it("public/sw.js exists and implements cache-first static strategy with api bypass", () => {
    assert.strictEqual(fs.existsSync(SW_PATH), true, "public/sw.js must exist");
    const swContent = fs.readFileSync(SW_PATH, "utf-8");

    assert.match(swContent, /addEventListener\(["']install["']/);
    assert.match(swContent, /addEventListener\(["']activate["']/);
    assert.match(swContent, /addEventListener\(["']fetch["']/);
    assert.match(swContent, /\/api\//, "Service worker must handle /api/ bypass");
    assert.match(swContent, /["']\/index\.html["']/, "Service worker must precache /index.html");
    assert.match(
      swContent,
      /\/_astro\//,
      "Service worker must discover and precache astro bundles",
    );
    assert.match(swContent, /location\.origin/, "Service worker must enforce same-origin check");
    assert.match(swContent, /caches\s*\.\s*open/, "Service worker must open static cache");
    assert.match(swContent, /caches\s*\.\s*match/, "Service worker must check cache first");
    assert.match(
      swContent,
      /event\s*\.\s*waitUntil/,
      "Service worker must use event.waitUntil for lifecycle operations",
    );
  });

  it("registerServiceWorker runs safely in browser environment and ignores unsupported environments", async () => {
    let registrationCalled = false;
    const originalNavigator = globalThis.navigator;
    const originalWindow = globalThis.window;

    try {
      // Test when serviceWorker is not supported
      Object.defineProperty(globalThis, "navigator", {
        value: {},
        writable: true,
        configurable: true,
      });
      registerServiceWorker(); // Should not throw

      // Test when serviceWorker is supported
      Object.defineProperty(globalThis, "navigator", {
        value: {
          serviceWorker: {
            register: async (scriptUrl: string) => {
              assert.strictEqual(scriptUrl, "/sw.js");
              registrationCalled = true;
              return {} as ServiceWorkerRegistration;
            },
          },
        },
        writable: true,
        configurable: true,
      });

      const listeners: Array<() => void> = [];
      Object.defineProperty(globalThis, "window", {
        value: {
          addEventListener: (_event: string, cb: () => void) => {
            listeners.push(cb);
          },
        },
        writable: true,
        configurable: true,
      });

      registerServiceWorker();
      assert.strictEqual(listeners.length, 1);
      listeners[0]();
      assert.strictEqual(registrationCalled, true);
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        value: originalNavigator,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(globalThis, "window", {
        value: originalWindow,
        writable: true,
        configurable: true,
      });
    }
  });

  it("registerServiceWorker catches registration errors and logs warning gracefully", async () => {
    const originalNavigator = globalThis.navigator;
    const originalWindow = globalThis.window;
    const originalConsoleWarn = console.warn;

    let warnCalledWith: unknown[] | null = null;
    console.warn = (...args: unknown[]) => {
      warnCalledWith = args;
    };

    try {
      const registrationError = new Error("Registration failed");
      Object.defineProperty(globalThis, "navigator", {
        value: {
          serviceWorker: {
            register: async () => {
              throw registrationError;
            },
          },
        },
        writable: true,
        configurable: true,
      });

      const listeners: Array<() => void> = [];
      Object.defineProperty(globalThis, "window", {
        value: {
          addEventListener: (_event: string, cb: () => void) => {
            listeners.push(cb);
          },
        },
        writable: true,
        configurable: true,
      });

      registerServiceWorker();
      assert.strictEqual(listeners.length, 1);
      listeners[0]();

      await new Promise((resolve) => setTimeout(resolve, 10));

      assert.ok(warnCalledWith !== null, "console.warn should be called on registration error");
      assert.strictEqual(warnCalledWith[0], "Service worker registration failed:");
      assert.strictEqual(warnCalledWith[1], registrationError);
    } finally {
      console.warn = originalConsoleWarn;
      Object.defineProperty(globalThis, "navigator", {
        value: originalNavigator,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(globalThis, "window", {
        value: originalWindow,
        writable: true,
        configurable: true,
      });
    }
  });
});

describe("PWA HTML Head and Meta Tags in Layout", () => {
  it("Layout.astro contains manifest link, apple meta tags, and viewport-fit=cover", () => {
    const layoutContent = fs.readFileSync(LAYOUT_PATH, "utf-8");

    assert.match(layoutContent, /<link[^>]+rel=["']manifest["'][^>]+href=["']\/manifest\.json["']/);
    assert.match(
      layoutContent,
      /<meta[^>]+name=["']apple-mobile-web-app-capable["'][^>]+content=["']yes["']/,
    );
    assert.match(
      layoutContent,
      /<meta[^>]+name=["']apple-mobile-web-app-status-bar-style["'][^>]+content=["']black-translucent["']/,
    );
    assert.match(
      layoutContent,
      /<meta[^>]+name=["']apple-mobile-web-app-title["'][^>]+content=["']SnapTally["']/,
    );
    assert.match(
      layoutContent,
      /<link[^>]+rel=["']apple-touch-icon["'][^>]+href=["']\/icons\/apple-touch-icon\.png["']/,
    );
    assert.match(layoutContent, /viewport-fit=cover/);
  });
});
