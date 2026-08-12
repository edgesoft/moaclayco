import type { LoaderFunction } from "react-router";
import { redirect } from "react-router";
import { auth } from "~/services/auth.server";
import {
  createGoogleAuthorization,
  GoogleAuthenticationError,
  GOOGLE_OAUTH_FLOW_SESSION_KEY,
} from "~/services/google-auth.server";
import { commitSession, getSession } from "~/services/session.server";

export const loader: LoaderFunction = async ({ request }) => {
  await auth.isAuthenticated(request, {
    successRedirect: "/admin/verifications",
  });

  try {
    const { url, flow } = await createGoogleAuthorization();
    const session = await getSession(request.headers.get("Cookie"));
    session.set(GOOGLE_OAUTH_FLOW_SESSION_KEY, flow);

    return redirect(url.toString(), {
      headers: { "Set-Cookie": await commitSession(session) },
    });
  } catch (error) {
    const code =
      error instanceof GoogleAuthenticationError
        ? error.code
        : "provider_error";
    console.error("Google authentication could not be started", {
      code,
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return redirect(`/login?error=${code}`);
  }
};
