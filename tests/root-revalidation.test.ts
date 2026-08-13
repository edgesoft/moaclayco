import assert from "node:assert/strict";
import test from "node:test";
import { shouldRevalidateRoot } from "../app/utils/rootRevalidation";

const revalidationArguments = (
  currentPath: string,
  nextPath: string,
  formMethod?: string
) => ({
    currentPathname: currentPath,
    defaultShouldRevalidate: true,
    formMethod,
    nextPathname: nextPath,
  });

test("catalog navigation reuses stable root data", () => {
  assert.equal(
    shouldRevalidateRoot(revalidationArguments("/", "/collections/wanja")),
    false
  );
  assert.equal(
    shouldRevalidateRoot(
      revalidationArguments("/collections/wanja", "/collections/molly")
    ),
    false
  );
});

test("admin navigation reuses the authenticated root payload", () => {
  assert.equal(
    shouldRevalidateRoot(revalidationArguments("/", "/admin/verifications")),
    false
  );
  assert.equal(
    shouldRevalidateRoot(
      revalidationArguments("/collections/wanja", "/admin/orders")
    ),
    false
  );
  assert.equal(
    shouldRevalidateRoot(
      revalidationArguments("/admin/orders", "/admin/verifications")
    ),
    false
  );
});

test("mutations and authentication routes still revalidate root data", () => {
  assert.equal(
    shouldRevalidateRoot(
      revalidationArguments("/collections/wanja", "/collections/wanja", "POST")
    ),
    true
  );
  assert.equal(
    shouldRevalidateRoot(
      revalidationArguments("/collections/wanja", "/logout")
    ),
    true
  );
});
