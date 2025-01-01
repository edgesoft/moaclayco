import {
  ActionFunction,
  json,
  LoaderFunction,
  redirect,
} from "@remix-run/node";
import { useLoaderData, useNavigate, useSubmit } from "@remix-run/react";
import { auth } from "~/services/auth.server";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import ClientOnly from "~/components/ClientOnly";
import Select from "react-select";
import { Users } from "~/schemas/user";
import { User } from "~/types";
import { commitSession, sessionStorage } from "~/services/session.server";

const formSchema = z.object({
  fiscalYear: z.string().min(1, "Datum är obligatoriskt"),
});

type FormData = z.infer<typeof formSchema>;

export const loader: LoaderFunction = async ({ request }) => {
  const user = await auth.isAuthenticated(request, {
    failureRedirect: "/login",
  });
  return json({ year: user.fiscalYear });
};

export const action: ActionFunction = async ({ request, params }) => {
  const formData = await request.formData();
  const user: User = await auth.isAuthenticated(request, {
    failureRedirect: "/login",
  });

  const fiscalYear = formData.get("fiscalYear");

  // Validera med Zod och kolla om resultatet är success
  const result = formSchema.safeParse({
    fiscalYear,
  });

  await Users.updateOne({ _id: user._id }, { fiscalYear });
  user.fiscalYear = parseInt(fiscalYear as string);

  let session = await sessionStorage.getSession(request.headers.get("cookie"));
  session.set("user", user);

  // commit the session
  let headers = new Headers({ "Set-Cookie": await commitSession(session) });

  return redirect("/admin/verifications", { headers });
};

interface CustomStyles {
  menu: (provided: any) => any;
  menuList: (provided: any) => any;
}

const customStyles: CustomStyles = {
  menu: (provided) => ({
    ...provided,
    zIndex: 5, // För säkerhet om andra element är överlappande
    maxHeight: "120px", // Sätter maxhöjden för den utvecklade dropdown-listan
    overflowY: "auto", // Gör dropdownen scrollbar om innehållet är längre
  }),
  menuList: (provided) => ({
    ...provided,
    maxHeight: "120px", // Höjden på själva listan
    padding: "0", // Minska padding om det behövs
  }),
};

export default function Settings() {
  const navigate = useNavigate();
  const submit = useSubmit();
  const { year } = useLoaderData<{ year: number }>();
  const getRelevantYears = (year: number): number[] => {
    return [year - 2, year - 1, year, year + 1];
  };

  const relevantYears = getRelevantYears(year).map((year) => ({
    label: year.toString(),
    value: year.toString(),
  }));

  const {
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      fiscalYear: year.toString(),
    },
  });

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
                  Välj bokföringsår
                </h3>
                <form
                  onSubmit={handleSubmit((data) => {
                    console.log(data);

                    submit(data, { method: "post" });
                  })}
                >
                  <div>
                    <Controller
                      control={control}
                      key={`fiscalYear`}
                      name={`fiscalYear`}
                      render={({ field }) => (
                        <ClientOnly fallback={null}>
                          {() => (
                            <Select
                              instanceId={`fiscalYear`}
                              {...field}
                              options={relevantYears}
                              onChange={(option) =>
                                field.onChange(option ? option.value : null)
                              }
                              value={relevantYears.find(
                                (acc) => acc.value === field.value
                              )}
                              placeholder="Välj bokföringsår"
                              styles={customStyles}
                            />
                          )}
                        </ClientOnly>
                      )}
                    />
                  </div>
                  <div>
                    <button
                      type="submit"
                      className="inline-flex justify-center mb-2 mt-2 px-4 py-2 w-full text-white text-base font-medium bg-blue-600 hover:bg-blue-700 border border-transparent rounded-md focus:outline-none shadow-sm focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 sm:w-auto sm:text-sm"
                    >
                      Spara
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
          <div className="bg-gray-50 px-6 py-3 flex justify-end">
            <div>
              <button
                type="button"
                className="inline-flex justify-center mb-2 mt-2 px-4 py-2 w-full text-white text-base font-medium bg-blue-600 hover:bg-blue-700 border border-transparent rounded-md focus:outline-none shadow-sm focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 sm:w-auto sm:text-sm"
                onClick={() => navigate(-1)}
              >
                Stäng
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
