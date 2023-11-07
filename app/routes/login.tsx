import { ActionFunction, LoaderFunction, json } from "@remix-run/node";
import { auth } from "~/services/auth.server";
import { sessionStorage } from "../services/session.server";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import useLocalStorage from "~/hooks/useLocalStorage";

export const action: ActionFunction = async ({ request }) => {
  return await auth.authenticate("email-link", request, {
    successRedirect: "/",
    failureRedirect: `/login`,
  });
};

export let loader: LoaderFunction = async ({ request }) => {
  await auth.isAuthenticated(request, { successRedirect: "/" });

  let session = await sessionStorage.getSession(request.headers.get("Cookie"));
  if (session.has("auth:magiclink")) return json({ magicLinkSent: true });
  return json({ magicLinkSent: false });
};

export default function Login() {
  const { magicLinkSent } = useLoaderData();
  let transition = useNavigation();
  let [email, setEmail] = useLocalStorage("mcc-email", "");

  return (
    <div className="flex items-center justify-center min-h-screen px-3">
      <div className="relative w-full max-w-md p-6 bg-white rounded-md shadow-md">
        <Form method="post">
          <h3 className="text-lg font-medium leading-6 text-gray-900">
            Logga in på ditt konto
          </h3>
          <div className="mt-2 text-black">
            {magicLinkSent
              ? "Länk skickad. Kolla din epost för mail från support@moaclayco.com"
              : transition.state !== "submitting" && (
                  <input
                    onChange={(e) => setEmail(e.target.value)}
                    defaultValue={email}
                    required
                    name="email"
                    placeholder="Epost"
                    type="text"
                    className="focus:shadow-outline w-full appearance-none rounded border border-slate-300 bg-white py-2 px-3 leading-tight text-slate-700 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-100 focus:ring-offset-2"
                  />
                )}
          </div>

          <div className="mt-4">
            <button
              onClick={() => {}}
              className="w-full px-4 py-2 text-sm font-medium text-white bg-blue-500 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:border-blue-700 focus:ring-blue active:bg-blue-700 transition duration-150 ease-in-out"
            >
              {magicLinkSent ? `Länk skickad` : `Skicka länk`}
            </button>
          </div>
        </Form>
      </div>
    </div>
  );
}
