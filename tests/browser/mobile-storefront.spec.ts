import { expect, test, type Page } from "@playwright/test";

async function acceptCookies(page: Page) {
  const acceptButton = page.getByRole("button", { name: "Acceptera cookies" });
  await expect(acceptButton).toBeVisible();
  await acceptButton.tap();
  await expect(acceptButton).toBeHidden();
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const viewportWidth = document.documentElement.clientWidth;
        return Math.max(
          document.documentElement.scrollWidth,
          document.body.scrollWidth
        ) - viewportWidth;
      })
    )
    .toBeLessThanOrEqual(1);
}

test("a touch user can open a Collection", async ({ page }) => {
  await page.goto("/");
  await acceptCookies(page);
  await expectNoHorizontalOverflow(page);

  await page
    .getByRole("link", { name: "Öppna kollektionen Wanja" })
    .tap();

  await expect(page).toHaveURL(/\/collections\/wanja$/);
  await expect(page.getByRole("heading", { name: "Wanja", level: 1 })).toBeVisible();

  const galleryZoom = page.locator(
    ".mcc-shop-item__gallery-meta .mcc-shop-item__zoom"
  ).first();
  const galleryDot = page.locator(
    ".mcc-shop-item__gallery-meta .mcc-shop-item__dots button"
  ).first();
  const galleryZoomBox = await galleryZoom.boundingBox();
  const galleryDotBox = await galleryDot.boundingBox();
  expect(galleryZoomBox).not.toBeNull();
  expect(galleryDotBox).not.toBeNull();
  expect(galleryZoomBox!.height).toBeGreaterThanOrEqual(42);
  expect(galleryZoomBox!.width).toBeGreaterThanOrEqual(42);
  expect(galleryDotBox!.height).toBeGreaterThanOrEqual(42);
  expect(galleryDotBox!.width).toBeGreaterThanOrEqual(42);
  await expectNoHorizontalOverflow(page);
});

test("collection gallery controls are touch-friendly", async ({ page }) => {
  await page.goto("/collections/hairpins");
  await acceptCookies(page);

  const firstGallery = page.locator(".mcc-shop-item").first();
  const controls = firstGallery.locator(
    ".mcc-shop-item__dots button, .mcc-shop-item__zoom, .mcc-shop-item__arrows button"
  );
  await expect(controls).toHaveCount(6);

  for (let index = 0; index < (await controls.count()); index += 1) {
    const controlBox = await controls.nth(index).boundingBox();
    expect(controlBox).not.toBeNull();
    expect(controlBox!.height).toBeGreaterThanOrEqual(42);
    expect(controlBox!.width).toBeGreaterThanOrEqual(42);
  }

  await firstGallery
    .getByRole("button", { name: /Nästa bild av/ })
    .tap();
  await expect(
    firstGallery.getByRole("button", { name: /Visa bild 2 av/ })
  ).toHaveAttribute("aria-current", "true");

  await firstGallery
    .getByRole("button", { name: /Visa .* i större format/ })
    .tap();
  const viewerControls = page.locator(".mcc-image-viewer__toolbar button");
  await expect(viewerControls).toHaveCount(5);
  for (let index = 0; index < (await viewerControls.count()); index += 1) {
    const controlBox = await viewerControls.nth(index).boundingBox();
    expect(controlBox).not.toBeNull();
    expect(controlBox!.height).toBeGreaterThanOrEqual(42);
    expect(controlBox!.width).toBeGreaterThanOrEqual(42);
  }
  await page.getByRole("button", { name: "Stäng stor bild" }).last().tap();
  await expectNoHorizontalOverflow(page);
});

test("the cart and fixed banner remain inside the mobile viewport", async ({
  page,
}) => {
  await page.goto("/collections/wanja");
  await acceptCookies(page);
  await page.getByRole("button", { name: /Lägg i varukorgen/ }).tap();
  await page.getByRole("button", { name: /Öppna varukorgen/ }).tap();

  await expect(page).toHaveURL(/\/cart$/);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "18px";
  });
  await expect(page.getByRole("heading", { name: "Varukorg" })).toBeVisible();

  const viewportWidth = page.viewportSize()!.width;
  const header = page.locator(".mcc-site-header");
  const initialHeader = await header.boundingBox();
  expect(initialHeader).not.toBeNull();
  expect(initialHeader!.height).toBeGreaterThanOrEqual(68);
  expect(initialHeader!.x).toBeGreaterThanOrEqual(-1);

  await page.evaluate(() => window.scrollTo(0, 700));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);

  const scrolledHeader = await header.boundingBox();
  expect(scrolledHeader).not.toBeNull();
  expect(scrolledHeader!.height).toBeGreaterThanOrEqual(68);
  expect(scrolledHeader!.x).toBeGreaterThanOrEqual(-1);
  expect(scrolledHeader!.y).toBeGreaterThanOrEqual(-1);

  for (const selector of [
    ".mcc-cart-hero__title",
    ".mcc-cart-hero h1",
    ".mcc-cart-hero__count",
  ]) {
    const box = await page.locator(selector).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewportWidth + 1);
  }

  const summaryHeading = await page
    .getByRole("heading", { name: "Sammanfattning" })
    .boundingBox();
  const summaryCurrency = await page
    .locator(".mcc-cart-summary .mcc-cart-section-heading > span")
    .boundingBox();
  expect(summaryHeading).not.toBeNull();
  expect(summaryCurrency).not.toBeNull();
  expect(summaryHeading!.x + summaryHeading!.width).toBeLessThanOrEqual(
    summaryCurrency!.x
  );
  await expectNoHorizontalOverflow(page);
});
