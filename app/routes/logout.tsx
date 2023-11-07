import { LoaderFunction, redirect } from "@remix-run/node";
import { destroySession, getSession, sessionStorage } from "../services/session.server";

export let loader: LoaderFunction = async ({ request }) => {
  const session = await getSession( request.headers.get("Cookie"));
  return redirect("/", {
    headers: {
      "Set-Cookie": await destroySession(session),
    },
  });

};
