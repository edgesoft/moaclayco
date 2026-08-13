import type { LoaderFunction } from "react-router";
import { redirect } from "react-router";
import { auth } from "~/services/auth.server";
import {
  completeGoogleAuthentication,
  GoogleAuthenticationError,
  GOOGLE_OAUTH_FLOW_SESSION_KEY,
  isGoogleOauthFlow,
} from "~/services/google-auth.server";
import { commitSession, getSession } from "~/services/session.server";
import {
  DEFAULT_AUTHENTICATED_REDIRECT,
  getLoginPath,
  getSafeAuthenticationReturnTo,
} from "~/utils/authRedirect";

// The trailing underscore in this route's filename keeps the callback from
// inheriting the /auth/google start loader.
export const loader: LoaderFunction = async ({ request }) => {
  const session = await getSession(request.headers.get("Cookie"));
  const flow = session.get(GOOGLE_OAUTH_FLOW_SESSION_KEY);
  session.unset(GOOGLE_OAUTH_FLOW_SESSION_KEY);

  if (!isGoogleOauthFlow(flow)) {
    return redirect(
      getLoginPath({
        error: "invalid_flow",
        returnTo: DEFAULT_AUTHENTICATED_REDIRECT,
      }),
      {
        headers: { "Set-Cookie": await commitSession(session) },
      }
    );
  }

  const returnTo = getSafeAuthenticationReturnTo(flow.returnTo);

  try {
    const user = await completeGoogleAuthentication(request, flow);
    session.set(auth.sessionKey, user);

    return redirect(returnTo, {
      headers: { "Set-Cookie": await commitSession(session) },
    });
  } catch (error) {
    const code =
      error instanceof GoogleAuthenticationError
        ? error.code
        : "provider_error";
    console.error("Google authentication failed", {
      code,
      name: error instanceof Error ? error.name : "UnknownError",
    });

    return redirect(getLoginPath({ error: code, returnTo }), {
      headers: { "Set-Cookie": await commitSession(session) },
    });
  }
};
