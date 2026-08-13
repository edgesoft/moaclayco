import { ActionFunction, LoaderFunction, redirect } from "react-router";
import { destroySession, getSession } from "../services/session.server";

const logout = async (request: Request) => {
  const session = await getSession(request.headers.get("Cookie"));
  return redirect("/", {
    headers: {
      "Set-Cookie": await destroySession(session),
    },
  });
};

export const action: ActionFunction = async ({ request }) => logout(request);

// Keep direct visits and old bookmarks safe while the UI uses POST.
export const loader: LoaderFunction = async ({ request }) => logout(request);
