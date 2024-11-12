import { useNavigate, useSubmit } from "@remix-run/react";
import { useLoaderData } from "@remix-run/react";
import {
  ActionFunctionArgs,
  json, LoaderFunctionArgs
} from "@remix-run/node";
import { cookieVerificationDomain, getVerificationDomain } from "~/services/cookie.server";
import { domains } from "~/utils/domain";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const verificationDomain = await getVerificationDomain(request);

  return json({ verificationDomain });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
    const formData = await request.formData();
    const domain = formData.get("domain");
    const verificationDomain = await getVerificationDomain(request);


  return json({}, {
    headers: {
        "Set-Cookie": await cookieVerificationDomain.serialize({
            ...verificationDomain, domain
        }),
      },
  });
};

export default function Files() {
  const data = useLoaderData(); // Hämta verifieringen och filerna
  const submit = useSubmit();
  const navigate = useNavigate();

  return (
    <div
      className="fixed z-10 inset-0 overflow-y-auto"
      aria-labelledby="modal-title"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex items-center justify-center min-h-screen text-center sm:block sm:p-0">
        <div className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"></div>
        <span
          className="hidden sm:inline-block sm:align-middle sm:h-screen"
          aria-hidden="true"
        >
          &#8203;
        </span>
        <div className="inline-block align-bottom w-full max-w-md  bg-white rounded-lg text-left shadow-xl overflow-hidden transform transition-all sm:align-middle sm:max-w-6xl">
          <div className="bg-white px-6 py-5">
            <div className="sm:flex sm:items-start">
              <div className="w-full sm:text-left">
                <h3
                  className="text-lg leading-6 font-medium text-gray-900"
                  id="modal-title"
                >
                  Inställningar
                </h3>

                <div className="mt-6">
                  {domains.map((d) => {
                    return <div className="cursor-pointer" style={{ marginLeft: -20, marginTop: -20 }} onClick={() => {
                        submit({domain: d.domain}, { method: "post" })
                    }}>{d.icon}</div>;
                  })}
                </div>
              </div>
            </div>
          </div>
          <div className="bg-gray-50 px-6 py-3 sm:flex sm:flex-row-reverse">
            <button
              type="button"
              className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:ml-3 sm:w-auto sm:text-sm"
              onClick={() => navigate(-1)}
            >
              Stäng
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
