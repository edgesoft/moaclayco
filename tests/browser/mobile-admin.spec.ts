import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { sessionStorage } from "../../app/services/session.server";

const baseUrl =
  process.env.MOBILE_E2E_BASE_URL ?? "http://localhost:3100";
const isLocalRun = ["127.0.0.1", "localhost"].includes(
  new URL(baseUrl).hostname
);

async function authenticateLocalAdmin(context: BrowserContext) {
  const session = await sessionStorage.getSession();
  session.set("user", {
    _id: "000000000000000000000001",
    email: "moaclayco-e2e@example.com",
    firstname: "Moa",
    fiscalYear: 2025,
    lastname: "Clay",
  });

  const setCookie = await sessionStorage.commitSession(session);
  const cookieHeader = setCookie.match(/^mcc_session=[^;]+/)?.[0];
  if (!cookieHeader) throw new Error("Kunde inte skapa lokal adminsession");

  const separator = cookieHeader.indexOf("=");
  const target = new URL(baseUrl);
  await context.addCookies([
    {
      domain: target.hostname,
      httpOnly: true,
      name: cookieHeader.slice(0, separator),
      path: "/",
      sameSite: "Lax",
      secure: target.protocol === "https:",
      value: cookieHeader.slice(separator + 1),
    },
  ]);
}

async function acceptCookiesIfNeeded(page: Page) {
  const acceptButton = page.getByRole("button", { name: "Acceptera cookies" });
  await expect(acceptButton).toBeVisible();
  await acceptButton.tap();
  await expect(acceptButton).toBeHidden();
}

async function dispatchSyntheticTouchPointer(
  page: Page,
  type: "pointerdown" | "pointermove" | "pointerup",
  point: { x: number; y: number },
  targetSelector?: string
) {
  await page.evaluate(
    ({ point, targetSelector, type }) => {
      const target = targetSelector
        ? document.querySelector(targetSelector)
        : window;
      if (!target) throw new Error(`Saknar mål för ${type}`);
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          button: 0,
          buttons: type === "pointerup" ? 0 : 1,
          cancelable: true,
          clientX: point.x,
          clientY: point.y,
          isPrimary: true,
          pointerId: 71,
          pointerType: "touch",
        })
      );
    },
    { point, targetSelector, type }
  );
}

test.describe("authenticated mobile admin", () => {
  test.skip(
    !isLocalRun,
    "Adminvyer testas lokalt med en signerad testsession, inte mot publik stage."
  );

  test.beforeEach(async ({ context }) => {
    await authenticateLocalAdmin(context);
  });

  test("the Collection atelier keeps mobile scroll separate from long-press sorting", async ({
    browserName,
    context,
    page,
  }) => {
    let orderSaves = 0;
    await page.route("**/admin/collections/order*", async (route) => {
      orderSaves += 1;
      await route.abort();
    });

    await page.goto("/");
    await acceptCookiesIfNeeded(page);
    await page
      .getByRole("button", { name: "Öppna Collection-verktyget" })
      .tap();

    const dialog = page.getByRole("dialog", { name: "Hantera Collections" });
    await expect(dialog).toBeVisible();
    const rows = dialog.locator(".mcc-atelier-collection");
    test.skip(
      (await rows.count()) < 3,
      "Gesttestet behöver minst tre Collections."
    );

    const row = rows.nth(2);
    const rowId = await row.getAttribute("data-collection-id");
    const rowBox = await row.boundingBox();
    expect(rowId).not.toBeNull();
    expect(rowBox).not.toBeNull();
    await expect(row).toHaveCSS("touch-action", "pan-y");

    const startPoint = {
      x: rowBox!.x + rowBox!.width / 2,
      y: rowBox!.y + rowBox!.height / 2,
    };
    const rowSelector = `.mcc-atelier-collection[data-collection-id="${rowId}"]`;

    if (browserName === "chromium") {
      const scrollArea = dialog.locator(".mcc-atelier-panel__scroll");
      const devtools = await context.newCDPSession(page);
      const touchPoint = (y: number) => [
        {
          id: 1,
          radiusX: 7,
          radiusY: 7,
          x: startPoint.x,
          y,
        },
      ];

      await devtools.send("Input.dispatchTouchEvent", {
        touchPoints: touchPoint(startPoint.y),
        type: "touchStart",
      });
      await page.waitForTimeout(45);
      for (const offset of [28, 64, 100]) {
        await devtools.send("Input.dispatchTouchEvent", {
          touchPoints: touchPoint(startPoint.y - offset),
          type: "touchMove",
        });
        await page.waitForTimeout(35);
      }
      await devtools.send("Input.dispatchTouchEvent", {
        touchPoints: [],
        type: "touchEnd",
      });

      await expect
        .poll(() => scrollArea.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(20);
      await expect(page.locator(".mcc-atelier-drag-overlay")).toHaveCount(0);
      expect(orderSaves).toBe(0);
      await scrollArea.evaluate((element) => {
        element.scrollTop = 0;
      });

      await devtools.send("Input.dispatchTouchEvent", {
        touchPoints: touchPoint(startPoint.y),
        type: "touchStart",
      });
      await expect(row).toHaveClass(/is-long-press-ready/, { timeout: 700 });
      await devtools.send("Input.dispatchTouchEvent", {
        touchPoints: touchPoint(startPoint.y + 6),
        type: "touchMove",
      });
      await expect(page.locator(".mcc-atelier-drag-overlay")).toBeVisible();
      await devtools.send("Input.dispatchTouchEvent", {
        touchPoints: [],
        type: "touchEnd",
      });
      await expect(page.locator(".mcc-atelier-drag-overlay")).toHaveCount(0);
      expect(orderSaves).toBe(0);
    }

    await dispatchSyntheticTouchPointer(
      page,
      "pointerdown",
      startPoint,
      rowSelector
    );
    await page.waitForTimeout(60);
    await dispatchSyntheticTouchPointer(page, "pointermove", {
      x: startPoint.x,
      y: startPoint.y - 36,
    });
    await page.waitForTimeout(360);
    await dispatchSyntheticTouchPointer(page, "pointerup", {
      x: startPoint.x,
      y: startPoint.y - 36,
    });

    await expect(row).not.toHaveClass(/is-long-press-ready|is-dragging/);
    await expect(page.locator(".mcc-atelier-drag-overlay")).toHaveCount(0);
    expect(orderSaves).toBe(0);

    await dispatchSyntheticTouchPointer(
      page,
      "pointerdown",
      startPoint,
      rowSelector
    );
    await expect(row).toHaveClass(/is-long-press-ready/, { timeout: 700 });
    await dispatchSyntheticTouchPointer(page, "pointermove", {
      x: startPoint.x,
      y: startPoint.y + 6,
    });
    await expect(page.locator(".mcc-atelier-drag-overlay")).toBeVisible();
    await dispatchSyntheticTouchPointer(page, "pointerup", {
      x: startPoint.x,
      y: startPoint.y + 6,
    });

    await expect(page.locator(".mcc-atelier-drag-overlay")).toHaveCount(0);
    await expect(row).not.toHaveClass(/is-long-press-ready|is-dragging/);
    expect(orderSaves).toBe(0);
  });

  test("the Collection atelier fills mobile and auto-scrolls a long order", async ({
    page,
  }, testInfo) => {
    let orderSaves = 0;
    await page.route("**/*", async (route) => {
      const request = route.request();
      const isCollectionOrderSave =
        request.method() === "POST" &&
        new URL(request.url()).pathname.startsWith(
          "/admin/collections/order"
        );
      if (!isCollectionOrderSave) {
        await route.continue();
        return;
      }

      orderSaves += 1;
      const payload = new URLSearchParams(request.postData() ?? "");
      const order = JSON.parse(payload.get("order") ?? "[]") as string[];
      const turboStreamBody = `${JSON.stringify([
        { _1: 2 },
        "data",
        { _3: 4, _5: 6 },
        "ok",
        true,
        "order",
        order.map((_collectionId, index) => index + 7),
        ...order,
      ])}\n`;
      await route.fulfill({
        body: turboStreamBody,
        headers: {
          "Content-Type": "text/x-script",
          "X-Remix-Response": "yes",
        },
        status: 200,
      });
    });

    await page.setViewportSize({ height: 900, width: 1280 });
    await page.goto("/");
    await acceptCookiesIfNeeded(page);

    const openAtelier = page.getByRole("button", {
      name: "Öppna Collection-verktyget",
    });
    await expect(openAtelier).toBeVisible();
    await expect(openAtelier).toHaveText("");
    await openAtelier.click();

    const dialog = page.getByRole("dialog", {
      name: "Hantera Collections",
    });
    await expect(dialog).toBeVisible();
    await expect
      .poll(async () => {
        const box = await dialog.boundingBox();
        return box
          ? Math.max(
              Math.abs(box.x + box.width - 1280),
              Math.abs(box.y + box.height - 900)
            )
          : Number.POSITIVE_INFINITY;
      })
      .toBeLessThanOrEqual(1);
    const desktopDialogBox = await dialog.boundingBox();
    const desktopTriggerBox = await page.locator(".mcc-atelier-trigger").boundingBox();
    expect(desktopDialogBox).not.toBeNull();
    expect(desktopTriggerBox).not.toBeNull();
    expect(1280 - desktopTriggerBox!.x - desktopTriggerBox!.width).toBeLessThanOrEqual(24);
    await page.screenshot({
      path: testInfo.outputPath("collection-atelier-desktop.png"),
    });

    await page.locator(".mcc-atelier-trigger").click();
    await page.setViewportSize({ height: 844, width: 390 });
    await page.evaluate(() => {
      const maxScroll = document.documentElement.scrollHeight - innerHeight;
      window.scrollTo(0, Math.min(320, maxScroll));
    });
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await openAtelier.click();
    await expect(dialog).toBeVisible();

    await expect
      .poll(() =>
        dialog.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return Math.max(
            Math.abs(rect.x),
            Math.abs(rect.y),
            Math.abs(rect.width - innerWidth),
            Math.abs(rect.height - innerHeight)
          );
        })
      )
      .toBeLessThanOrEqual(1);

    const dialogBox = await dialog.boundingBox();
    expect(dialogBox).not.toBeNull();
    expect(dialogBox!.x).toBeCloseTo(0, 0);
    expect(dialogBox!.y).toBeCloseTo(0, 0);
    expect(dialogBox!.width).toBeCloseTo(390, 0);
    expect(dialogBox!.height).toBeCloseTo(844, 0);
    await page.screenshot({
      path: testInfo.outputPath("collection-atelier-mobile.png"),
    });
    await expect(
      dialog.getByText("Dra i handtaget eller använd pilarna.")
    ).toHaveCount(0);
    const closeButtonBox = await page
      .locator(".mcc-atelier-trigger")
      .boundingBox();
    expect(closeButtonBox).not.toBeNull();
    expect(closeButtonBox!.width).toBeLessThanOrEqual(46);

    const rows = dialog.locator(".mcc-atelier-collection");
    test.skip(
      (await rows.count()) < 8,
      "Auto-scroll behöver en Collection-lista som är högre än panelen."
    );

    const scrollArea = dialog.locator(".mcc-atelier-panel__scroll");
    await scrollArea.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(dialog.getByRole("link", {
      name: "Skapa en Collection",
    })).toBeInViewport();
    const lastRow = rows.last();
    const draggedHeadline = await lastRow.locator("strong").innerText();
    const draggedCollectionId = await lastRow.getAttribute("data-collection-id");
    const draggedOriginNumber = await lastRow
      .locator(".mcc-atelier-collection__number-current")
      .innerText();
    expect(draggedCollectionId).not.toBeNull();
    await lastRow.scrollIntoViewIfNeeded();
    const initialScrollTop = await scrollArea.evaluate(
      (element) => element.scrollTop
    );
    expect(initialScrollTop).toBeGreaterThan(100);
    const rowBox = await lastRow.boundingBox();
    const scrollBox = await scrollArea.boundingBox();
    expect(rowBox).not.toBeNull();
    expect(scrollBox).not.toBeNull();

    await page.mouse.move(
      rowBox!.x + 12,
      rowBox!.y + rowBox!.height / 2
    );
    await page.mouse.down();
    await page.mouse.move(
      rowBox!.x + 12,
      rowBox!.y + rowBox!.height / 2 - 18,
      { steps: 4 }
    );
    await page.waitForTimeout(600);
    const scrollTopAfterSmallMovement = await scrollArea.evaluate(
      (element) => element.scrollTop
    );
    expect(Math.abs(scrollTopAfterSmallMovement - initialScrollTop)).toBeLessThanOrEqual(2);
    await page.mouse.move(
      rowBox!.x + 12,
      scrollBox!.y + 18,
      { steps: 14 }
    );
    await page.waitForTimeout(700);

    const scrolledUpTo = await scrollArea.evaluate(
      (element) => element.scrollTop
    );
    const firstScrollDelta = initialScrollTop - scrolledUpTo;
    expect(firstScrollDelta).toBeGreaterThan(35);
    expect(firstScrollDelta).toBeLessThan(220);
    await expect
      .poll(() => scrollArea.evaluate((element) => element.scrollTop), {
        timeout: 12_000,
      })
      .toBeLessThanOrEqual(2);
    await page.waitForTimeout(500);
    expect(
      await scrollArea.evaluate((element) => element.scrollTop)
    ).toBeLessThanOrEqual(2);
    const dragOverlay = page.locator(".mcc-atelier-drag-overlay");
    await expect(dragOverlay).toBeVisible();
    const activeUpwardOverlayBox = await dragOverlay.boundingBox();
    expect(activeUpwardOverlayBox).not.toBeNull();
    expect(
      activeUpwardOverlayBox!.y + activeUpwardOverlayBox!.height
    ).toBeGreaterThan(0);
    expect(activeUpwardOverlayBox!.y).toBeLessThan(844);
    const activeDraggedRow = dialog.locator(
      `.mcc-atelier-collection[data-collection-id="${draggedCollectionId}"]`
    );
    await expect(
      activeDraggedRow.locator(".mcc-atelier-collection__number-current")
    ).not.toHaveText(draggedOriginNumber);
    await expect(
      activeDraggedRow.locator(".mcc-atelier-collection__number-origin")
    ).toHaveText(draggedOriginNumber);
    await page.mouse.up();
    await expect(rows.first().locator("strong")).toHaveText(draggedHeadline);
    await expect(dragOverlay).toHaveCount(0);
    await expect(activeDraggedRow).not.toHaveClass(/is-dragging/);
    await expect(page.locator(".mcc-atelier-cancel-icon")).toHaveCount(0);
    await expect(scrollArea).not.toHaveClass(/is-sorting/);
    await expect(rows.nth(0)).toHaveClass(/is-featured/);
    await expect(rows.nth(1)).toHaveClass(/is-featured/);
    await expect(rows.nth(2)).not.toHaveClass(/is-featured/);
    const featuredMarker = await rows.first().evaluate((element) => {
      const marker = getComputedStyle(element, "::before");
      return {
        backgroundColor: marker.backgroundColor,
        height: marker.height,
        width: marker.width,
      };
    });
    expect(featuredMarker.width).toBe("2px");
    expect(featuredMarker.height).not.toBe("0px");
    expect(featuredMarker.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    await expect
      .poll(() => orderSaves)
      .toBe(1);
    await expect(page.locator(".mcc-atelier-check-icon")).toBeVisible();
    await expect(page.locator(".mcc-atelier-check-icon")).toHaveCount(0, {
      timeout: 2_500,
    });

    await scrollArea.evaluate((element) => {
      element.scrollTop = 0;
    });
    const downwardRow = rows.first();
    const downwardHeadline = await downwardRow.locator("strong").innerText();
    const downwardId = await downwardRow.getAttribute("data-collection-id");
    const downwardMediaBox = await downwardRow
      .locator(".mcc-atelier-collection__media")
      .boundingBox();
    expect(downwardId).not.toBeNull();
    expect(downwardMediaBox).not.toBeNull();

    await page.mouse.move(
      downwardMediaBox!.x + downwardMediaBox!.width / 2,
      downwardMediaBox!.y + downwardMediaBox!.height / 2
    );
    await page.mouse.down();
    await page.mouse.move(
      downwardMediaBox!.x + downwardMediaBox!.width / 2,
      downwardMediaBox!.y + downwardMediaBox!.height / 2 + 18,
      { steps: 4 }
    );
    await page.waitForTimeout(500);
    expect(
      await scrollArea.evaluate((element) => element.scrollTop)
    ).toBeLessThanOrEqual(2);
    await page.mouse.move(
      downwardMediaBox!.x + downwardMediaBox!.width / 2,
      scrollBox!.y + scrollBox!.height - 24,
      { steps: 14 }
    );
    await page.waitForTimeout(700);

    const downwardActiveRow = dialog.locator(
      `.mcc-atelier-collection[data-collection-id="${downwardId}"]`
    );
    await expect(downwardActiveRow).toHaveClass(/is-dragging/);
    await expect(dragOverlay).toBeVisible();
    const activeDownwardBox = await dragOverlay.boundingBox();
    expect(activeDownwardBox).not.toBeNull();
    expect(activeDownwardBox!.y + activeDownwardBox!.height).toBeGreaterThan(0);
    expect(activeDownwardBox!.y).toBeLessThan(844);
    await expect
      .poll(
        () =>
          scrollArea.evaluate(
            (element) =>
              element.scrollHeight - element.clientHeight - element.scrollTop
          ),
        { timeout: 12_000 }
      )
      .toBeLessThanOrEqual(2);
    await page.waitForTimeout(500);
    await expect(downwardActiveRow).toHaveClass(/is-dragging/);
    await page.mouse.up();
    await expect(rows.last().locator("strong")).toHaveText(downwardHeadline);
    await expect(dragOverlay).toHaveCount(0);
    await expect
      .poll(() => orderSaves)
      .toBe(2);
    await expect(downwardActiveRow).not.toHaveClass(/is-dragging/);
    await expect(scrollArea).not.toHaveClass(/is-sorting/);

    const orderBeforeCancel = await rows.locator("strong").allTextContents();
    const cancelDragRow = rows.first();
    await cancelDragRow.scrollIntoViewIfNeeded();
    const cancelDragId = await cancelDragRow.getAttribute("data-collection-id");
    const cancelOriginNumber = await cancelDragRow
      .locator(".mcc-atelier-collection__number-current")
      .innerText();
    const cancelDragRowBox = await cancelDragRow.boundingBox();
    const originPreviewTargetBox = await rows.nth(3).boundingBox();
    const cancelTargetBox = await page
      .locator(".mcc-atelier-trigger")
      .boundingBox();
    expect(cancelDragId).not.toBeNull();
    expect(cancelDragRowBox).not.toBeNull();
    expect(originPreviewTargetBox).not.toBeNull();
    expect(cancelTargetBox).not.toBeNull();

    await page.mouse.move(
      cancelDragRowBox!.x + 12,
      cancelDragRowBox!.y + cancelDragRowBox!.height / 2
    );
    await page.mouse.down();
    await page.mouse.move(
      cancelDragRowBox!.x + 18,
      cancelDragRowBox!.y + cancelDragRowBox!.height / 2 - 8
    );
    await expect(page.locator(".mcc-atelier-cancel-icon")).toBeVisible();
    await page.mouse.move(
      originPreviewTargetBox!.x + 18,
      originPreviewTargetBox!.y + originPreviewTargetBox!.height / 2,
      { steps: 8 }
    );
    const cancelActiveRow = dialog.locator(
      `.mcc-atelier-collection[data-collection-id="${cancelDragId}"]`
    );
    await expect(
      cancelActiveRow.locator(".mcc-atelier-collection__number-current")
    ).not.toHaveText(cancelOriginNumber);
    await expect(
      cancelActiveRow.locator(".mcc-atelier-collection__number-origin")
    ).toHaveText(cancelOriginNumber);
    await page.screenshot({
      path: testInfo.outputPath("collection-atelier-origin-number.png"),
    });
    await page.mouse.move(
      cancelTargetBox!.x + cancelTargetBox!.width / 2,
      cancelTargetBox!.y + cancelTargetBox!.height / 2,
      { steps: 12 }
    );
    await expect(page.locator(".mcc-atelier-trigger")).toHaveClass(
      /is-cancel-armed/
    );
    await page.screenshot({
      path: testInfo.outputPath("collection-atelier-cancel-target.png"),
    });
    await page.mouse.up();

    await expect(page.locator(".mcc-atelier-cancel-icon")).toHaveCount(0);
    await expect
      .poll(() => rows.locator("strong").allTextContents())
      .toEqual(orderBeforeCancel);
    expect(orderSaves).toBe(2);

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const sourceIndex = attempt % 2 === 0 ? 5 : 6;
      const targetIndex = attempt % 2 === 0 ? 6 : 5;
      const sourceRow = rows.nth(sourceIndex);
      const targetRow = rows.nth(targetIndex);
      await sourceRow.scrollIntoViewIfNeeded();
      const sourceId = await sourceRow.getAttribute("data-collection-id");
      const sourceBox = await sourceRow.boundingBox();
      const targetBox = await targetRow.boundingBox();
      expect(sourceId).not.toBeNull();
      expect(sourceBox).not.toBeNull();
      expect(targetBox).not.toBeNull();

      await page.mouse.move(
        sourceBox!.x + 18,
        sourceBox!.y + sourceBox!.height / 2
      );
      await page.mouse.down();
      await page.mouse.move(
        targetBox!.x + 18,
        targetBox!.y + targetBox!.height / 2,
        { steps: 7 }
      );
      await page.mouse.up();

      const releasedRow = dialog.locator(
        `.mcc-atelier-collection[data-collection-id="${sourceId}"]`
      );
      await expect(releasedRow).not.toHaveClass(/is-dragging/);
      await expect(dragOverlay).toHaveCount(0);
      await expect(page.locator(".mcc-atelier-cancel-icon")).toHaveCount(0);
      await expect(scrollArea).not.toHaveClass(/is-sorting/);
      await expect
        .poll(() => releasedRow.evaluate((element) => element.isConnected))
        .toBe(true);
    }

    const editLink = rows.nth(4).getByRole("link", { name: /^Redigera / });
    const editHref = await editLink.getAttribute("href");
    expect(editHref).toMatch(/^\/collections\/.+\/edit$/);
    await editLink.click();
    await expect(page).toHaveURL(new RegExp(`${editHref}$`));
  });

  test("accounting search and new verification stay below the site header", async ({
    page,
  }) => {
    await page.goto("/admin/verifications");
    await acceptCookiesIfNeeded(page);

    await expect(
      page.getByRole("heading", { level: 1, name: "Bokföring" })
    ).toBeVisible();
    await expect(page.getByText("Moms klar", { exact: true })).toHaveCount(0);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    const header = page.locator(".mcc-site-header");
    const toolbar = page.locator(".accounting-sticky-tools");
    const newVerification = page.getByRole("link", {
      name: /Ny(?: verifikation)?/,
    });

    await expect(toolbar).toBeInViewport();
    await expect(page.getByRole("searchbox")).toBeVisible();
    await expect(newVerification).toBeVisible();

    const headerBox = await header.boundingBox();
    const toolbarBox = await toolbar.boundingBox();
    expect(headerBox).not.toBeNull();
    expect(toolbarBox).not.toBeNull();
    expect(
      Math.abs(toolbarBox!.y - (headerBox!.y + headerBox!.height))
    ).toBeLessThanOrEqual(2);

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("the discount add SVG is centered at Pixel 10 width", async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto("/admin/discounts");
    await acceptCookiesIfNeeded(page);

    const createLink = page.locator(
      ".mcc-discount-list-title .mcc-discount-create"
    );
    const icon = createLink.locator(".mcc-plus-minus-icon");

    await expect(createLink).toBeVisible();
    await expect(icon).toHaveCount(1);
    await expect
      .poll(() =>
        createLink.evaluate((element) => {
          const controlRect = element.getBoundingClientRect();
          const iconRect = element
            .querySelector(".mcc-plus-minus-icon")!
            .getBoundingClientRect();

          return Math.max(
            Math.abs(
              controlRect.left + controlRect.width / 2 -
                (iconRect.left + iconRect.width / 2)
            ),
            Math.abs(
              controlRect.top + controlRect.height / 2 -
                (iconRect.top + iconRect.height / 2)
            )
          );
        })
      )
    .toBeLessThanOrEqual(0.5);
  });

  for (const destination of [
    {
      heading: "Bokföring",
      label: "Bokföring",
      path: "/admin/verifications",
    },
    { heading: "Ordrar", label: "Ordrar", path: "/admin/orders" },
  ]) {
    test(`menu keeps a responsive transition while ${destination.label} loads`, async ({
      page,
    }) => {
      await page.route(`**${destination.path}*`, async (route) => {
        if (route.request().resourceType() === "fetch") {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        await route.continue();
      });

      await page.goto("/");
      await acceptCookiesIfNeeded(page);
      await page.getByRole("button", { name: "Öppna meny" }).tap();

      const dialog = page.getByRole("dialog", { name: "Huvudmeny" });
      const destinationLink = dialog.getByRole("link", {
        name: new RegExp(destination.label),
      });
      await expect(dialog).toBeVisible();

      await destinationLink.click({ noWaitAfter: true });
      await expect(destinationLink).toHaveAttribute("aria-busy", "true");
      await expect(dialog).toBeVisible();

      await expect(
        page.getByRole("heading", { level: 1, name: destination.heading })
      ).toBeVisible();
      await expect(dialog).toBeHidden();
    });
  }
});
