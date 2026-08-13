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

test.describe("authenticated mobile admin", () => {
  test.skip(
    !isLocalRun,
    "Adminvyer testas lokalt med en signerad testsession, inte mot publik stage."
  );

  test.beforeEach(async ({ context }) => {
    await authenticateLocalAdmin(context);
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
