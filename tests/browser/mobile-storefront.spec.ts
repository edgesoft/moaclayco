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

async function expectContextPanelBelowHeader(page: Page) {
  const headerBox = await page.locator(".mcc-site-header").boundingBox();
  const panelBox = await page
    .locator(".mcc-scroll-context-wrap")
    .boundingBox();
  const viewport = page.viewportSize();

  expect(headerBox).not.toBeNull();
  expect(panelBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(panelBox!.y).toBeGreaterThanOrEqual(
    headerBox!.y + headerBox!.height
  );
  expect(panelBox!.x).toBeGreaterThanOrEqual(-1);
  expect(panelBox!.width).toBeGreaterThanOrEqual(viewport!.width - 1);
  expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(
    viewport!.width + 1
  );
}

test("the menu opens across the full viewport in tablet WebKit layout", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");
  await acceptCookies(page);

  const menuButton = page.getByRole("button", { name: "Öppna meny" });
  await menuButton.tap();

  await expect(menuButton).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("dialog", { name: "Huvudmeny" })).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".mcc-navigation-layer")
        .evaluate((layer) => layer.parentElement === document.body)
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(
          document
            .elementFromPoint(innerWidth / 2, innerHeight / 2)
            ?.closest(".mcc-navigation-layer")
        )
      )
    )
    .toBe(true);

  const headerBox = await page.locator(".mcc-site-header").boundingBox();
  const layerBox = await page.locator(".mcc-navigation-layer").boundingBox();
  expect(headerBox).not.toBeNull();
  expect(layerBox).not.toBeNull();
  expect(layerBox!.height).toBeGreaterThan(headerBox!.height * 4);

  await page.locator(".mcc-navigation-rail .mcc-navigation-close").tap();
  await expect(page.locator(".mcc-navigation-layer")).toHaveCount(0);
});

test("a touch user can open a Collection", async ({ page }) => {
  await page.goto("/");
  await acceptCookies(page);
  await expectNoHorizontalOverflow(page);

  const collectionScene = page.locator(
    '[data-banner-context-kind="collection"][data-banner-context-title="Wanja"]'
  );
  const collectionLink = collectionScene.getByRole("link", {
    name: "Se Collection",
    exact: true,
  });
  await collectionScene.evaluate((element) => {
    window.scrollTo(0, (element as HTMLElement).offsetTop + 80);
  });
  await expect(page.locator(".mcc-scroll-collection-nav")).toBeVisible();
  await expectContextPanelBelowHeader(page);

  await collectionLink.tap();

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

  const nextImageButton = firstGallery.getByRole("button", {
    name: /Nästa bild av/,
  });
  await nextImageButton.tap();
  await expect(
    firstGallery.getByRole("button", { name: /Visa bild 2 av/ })
  ).toHaveAttribute("aria-current", "true");
  await expect
    .poll(() =>
      nextImageButton.evaluate((button) => getComputedStyle(button).color)
    )
    .not.toBe("rgb(255, 255, 255)");

  await firstGallery
    .getByRole("button", { name: /Visa .* i större format/ })
    .tap();
  await expect
    .poll(() =>
      page
        .locator(".mcc-image-viewer")
        .evaluate((viewer) => viewer.parentElement === document.body)
    )
    .toBe(true);
  const viewerControls = page.locator(".mcc-image-viewer__toolbar button");
  await expect(viewerControls).toHaveCount(5);
  for (let index = 0; index < (await viewerControls.count()); index += 1) {
    const controlBox = await viewerControls.nth(index).boundingBox();
    expect(controlBox).not.toBeNull();
    expect(controlBox!.height).toBeGreaterThanOrEqual(42);
    expect(controlBox!.width).toBeGreaterThanOrEqual(42);
  }

  const wheelWasCancelled = await page
    .locator(".mcc-image-viewer__stage")
    .evaluate((stage) => {
      const wheel = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: -120,
      });
      return !stage.dispatchEvent(wheel);
    });
  expect(wheelWasCancelled).toBe(true);
  await expect(page.getByRole("button", { name: "Återställ zoom" })).toHaveText(
    "135%"
  );

  await page.getByRole("button", { name: "Stäng stor bild" }).last().tap();
  await expectNoHorizontalOverflow(page);
});

test("the login dialog is detached from animated route containers", async ({
  page,
}) => {
  await page.goto("/login");

  const loginDialog = page.getByRole("dialog", {
    name: "Fint att se dig igen.",
  });
  await expect(loginDialog).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".mcc-login-modal")
        .evaluate((modal) => modal.parentElement === document.body)
    )
    .toBe(true);

  const modalBox = await page.locator(".mcc-login-modal").boundingBox();
  const viewport = page.viewportSize();
  expect(modalBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(modalBox!.width).toBeGreaterThanOrEqual(viewport!.width - 1);
  expect(modalBox!.height).toBeGreaterThanOrEqual(viewport!.height - 1);
});

test("Collection storytelling scrolls without sticky mobile pauses", async ({
  page,
}) => {
  await page.goto("/");
  await acceptCookies(page);

  const layout = await page.evaluate(() => {
    const collectionScene = document.querySelector<HTMLElement>(
      ".mcc-collection-scene"
    );
    const collectionStage = document.querySelector<HTMLElement>(
      ".mcc-collection-scene__stage"
    );

    return {
      collectionSceneHeight: collectionScene?.getBoundingClientRect().height,
      collectionStageHeight: collectionStage?.getBoundingClientRect().height,
      collectionStagePosition: collectionStage
        ? getComputedStyle(collectionStage).position
        : null,
    };
  });

  expect(layout.collectionStagePosition).toBe("relative");
  expect(layout.collectionSceneHeight).toBeDefined();
  expect(layout.collectionStageHeight).toBeDefined();
  expect(
    Math.abs(layout.collectionSceneHeight! - layout.collectionStageHeight!)
  ).toBeLessThanOrEqual(2);

  const firstScene = page.locator(".mcc-collection-scene").first();
  const parallax = firstScene.locator(".mcc-collection-scene__parallax");
  await firstScene.evaluate((element) => {
    window.scrollTo(0, (element as HTMLElement).offsetTop - innerHeight * 0.45);
  });
  await expect
    .poll(() =>
      parallax.evaluate((element) => getComputedStyle(element).transform)
    )
    .not.toBe("none");
  const enteringTransform = await parallax.evaluate(
    (element) => getComputedStyle(element).transform
  );
  await firstScene.evaluate((element) => {
    window.scrollTo(0, (element as HTMLElement).offsetTop + innerHeight * 0.35);
  });
  await expect
    .poll(() =>
      parallax.evaluate((element) => getComputedStyle(element).transform)
    )
    .not.toBe(enteringTransform);
});

test("WebKit keeps every Collection image joined to its text card", async ({
  browserName,
  page,
}) => {
  test.skip(browserName !== "webkit", "Physical iOS uses WebKit layout rules");

  await page.goto("/");
  await acceptCookies(page);

  const measurements = await page
    .locator(".mcc-collection-scene")
    .evaluateAll((scenes) =>
      scenes.map((scene) => {
        const media = scene
          .querySelector<HTMLElement>(".mcc-collection-scene__media")!
          .getBoundingClientRect();
        const copyElement = scene.querySelector<HTMLElement>(
          ".mcc-collection-scene__copy"
        )!;
        const copy = copyElement.getBoundingClientRect();

        return {
          gap: copy.top - media.bottom,
          title: scene.getAttribute("data-banner-context-title"),
          transform: getComputedStyle(copyElement).transform,
        };
      })
    );

  expect(measurements.length).toBeGreaterThan(0);
  for (const measurement of measurements) {
    expect(measurement.transform, measurement.title ?? undefined).toBe("none");
    expect(measurement.gap, measurement.title ?? undefined).toBeGreaterThan(15);
    expect(measurement.gap, measurement.title ?? undefined).toBeLessThan(17);
  }

  const gaps = measurements.map(({ gap }) => gap);
  expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(0.5);
});

test("all Collection routes fit the mobile viewport", async ({ page }) => {
  test.setTimeout(90_000);

  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/");
  await acceptCookies(page);
  const collectionHrefs = await page
    .locator('[data-banner-context-kind="collection"]')
    .evaluateAll((elements) =>
      Array.from(
        new Set(
          elements
            .map((element) => element.getAttribute("data-banner-context-href"))
            .filter((href): href is string => Boolean(href))
        )
      )
    );
  expect(collectionHrefs.length).toBeGreaterThan(0);

  for (const href of collectionHrefs) {
    const response = await page.goto(href);
    expect(response?.status(), href).toBeLessThan(400);
    await expect(page.locator("main h1")).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const products = page.locator('[data-banner-context-kind="item"]');
    const productCount = await products.count();
    expect(productCount, href).toBeGreaterThan(0);
    await products.first().evaluate((element) => {
      window.scrollTo(0, (element as HTMLElement).offsetTop + 80);
    });

    if (productCount > 1) {
      await expect(page.locator(".mcc-scroll-collection-nav")).toBeVisible();
      await expectContextPanelBelowHeader(page);
    } else {
      await expect(page.locator(".mcc-scroll-collection-nav")).toHaveCount(0);
    }
  }

  expect(
    pageErrors.filter(
      (message) =>
        !message.includes("/__manifest?") ||
        !message.includes("access control checks")
    )
  ).toEqual([]);
});

test("the fixed product navigator loops at both ends", async ({ page }) => {
  await page.goto("/collections/molly");
  await acceptCookies(page);

  const products = page.locator('[data-banner-context-kind="item"]');
  const productCount = await products.count();
  expect(productCount).toBeGreaterThan(1);

  const firstTitle = await products
    .first()
    .getAttribute("data-banner-context-title");
  const firstHref = await products
    .first()
    .getAttribute("data-banner-context-href");
  const lastTitle = await products
    .last()
    .getAttribute("data-banner-context-title");
  const lastHref = await products
    .last()
    .getAttribute("data-banner-context-href");
  expect(firstTitle).toBeTruthy();
  expect(firstHref).toBeTruthy();
  expect(lastTitle).toBeTruthy();
  expect(lastHref).toBeTruthy();

  await page.evaluate(() => {
    const items = document.querySelectorAll<HTMLElement>(
      '[data-banner-context-kind="item"]'
    );
    const lastItem = items.item(items.length - 1);
    window.scrollTo(0, lastItem.offsetTop + 80);
  });

  const navigator = page.locator(".mcc-scroll-collection-nav");
  const previous = navigator.locator(
    ".mcc-scroll-collection-nav__link--previous"
  );
  const next = navigator.locator(".mcc-scroll-collection-nav__link--next");
  await expect(previous).toHaveAttribute(
    "aria-label",
    new RegExp(`^Föregående produkt:`)
  );
  await expect(next).toHaveAttribute(
    "aria-label",
    `Nästa produkt: ${firstTitle}`
  );
  await expectContextPanelBelowHeader(page);

  for (const link of [previous, next]) {
    const box = await link.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(56);
  }

  await next.tap();
  await expect(page).toHaveURL(
    new RegExp(`${firstHref!.split("#").at(-1)}$`)
  );
  await expect(previous).toHaveAttribute(
    "aria-label",
    `Föregående produkt: ${lastTitle}`
  );
  await expect(next).toBeVisible();

  await previous.tap();
  await expect(page).toHaveURL(
    new RegExp(`${lastHref!.split("#").at(-1)}$`)
  );
  await expect(next).toBeVisible();
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
