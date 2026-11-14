import { expect, test } from "@playwright/test";

test("manifest provides standalone start URL and loadable install icons", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const manifestPath = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(manifestPath).toBe("/manifest.json");
  if (!manifestPath) throw new Error("Missing web app manifest link");
  const response = await request.get(manifestPath);
  const manifest = await response.json();
  expect(manifest).toMatchObject({ start_url: "/", display: "standalone", scope: "/" });
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sizes: "192x192" }),
      expect.objectContaining({ sizes: "512x512" }),
      expect.objectContaining({ purpose: "maskable" }),
    ]),
  );
  for (const icon of manifest.icons) {
    expect((await request.get(icon.src)).ok()).toBe(true);
  }
});

test("service worker activates, precaches the shell and reloads offline", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Playwright service-worker automation is supported on Chromium.",
  );
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), {
          once: true,
        }),
      );
    }
  });
  const cached = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const cache = await caches.open("snaptally-shell-v1");
    return {
      state: registration.active?.state,
      paths: (await cache.keys()).map((request) => new URL(request.url).pathname),
    };
  });
  expect(cached.state).toBe("activated");
  expect(cached.paths).toEqual(
    expect.arrayContaining(["/", "/index.html", "/manifest.json", "/theme-init.js"]),
  );
  expect(cached.paths.some((path) => path.startsWith("/_astro/"))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole("button", { name: "5", exact: true }).click();
  await expect(page.getByText("USD $0.05", { exact: true })).toBeVisible();
});
