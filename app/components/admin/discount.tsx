import {
  useFetcher,
  useLoaderData,
  useLocation,
  useNavigate,
} from "@remix-run/react";
import React, { useEffect } from "react";
import { classNames } from "~/utils/classnames";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "react-toastify";
import { formatDateToUTC } from "~/utils/formatDateToUTC";
import { DiscountType } from "~/types";
import { formSchema } from "~/actions/discount";

type FormData = z.infer<typeof formSchema>;

const getLabel = (balance: number) => {
  if (!balance || balance === 0) {
    return {
      headline: `Slut`,
      color: "bg-blue-600",
    };
  }
  return { headline: `${balance}`, color: "bg-green-600" };
};

const DiscountLabel: React.FC<{ balance: number }> = ({
  balance,
}): JSX.Element | null => {
  const label = getLabel(balance);
  return (
    <span
      className={`${label.color} text-white inline-flex px-2 text-xs font-semibold leading-5 rounded-full`}
    >
      {label.headline}
    </span>
  );
};

export default function Discount() {
  let data = useLoaderData<DiscountType>();
  let navigate = useNavigate();
  let location = useLocation();
  let fetcher = useFetcher();

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.warn(fetcher.data.error, {
        position: "top-right",
        autoClose: 1500,
        hideProgressBar: true,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: false,
        progress: undefined,
        theme: "dark",
      });
    }
  }, [fetcher.state, fetcher.data]);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
  });

  const onSubmit = (data: FormData) => {
    fetcher.submit({ action: "save", ...data }, { method: "post" });
  };

  const handleDelete = async () => {
    if (window.confirm("Är du säker på att du vill ta bort denna rabattkod?")) {
      fetcher.submit({ action: "delete" }, { method: "post" });
    }
  };

  useEffect(() => {
    return () => {
      const scrollY = sessionStorage.getItem("scrollPosition");
      window.scrollTo(0, scrollY ? parseInt(scrollY, 10) : 0);
    };
  }, [location.key]);

  return (
    <div
      className="fixed z-10 inset-0 overflow-y-auto"
      aria-labelledby="modal-title"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex items-end justify-center pb-20 pt-4 px-4 min-h-screen text-center sm:block sm:p-0 relative">
        <div
          className="fixed inset-0 bg-black bg-opacity-75 transition-opacity"
          aria-hidden="true"
        ></div>

        <span
          className="hidden sm:inline-block sm:align-middle sm:h-screen"
          aria-hidden="true"
        >
          &#8203;
        </span>
        <div className="inline-block align-bottom text-left bg-white rounded-lg shadow-xl overflow-hidden transform transition-all sm:align-middle sm:my-8 sm:w-full sm:max-w-lg">
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            className={classNames(
              "absolute right-2 top-2 mr-1 text-2xl font-normal leading-none bg-transparent outline-none focus:outline-none"
            )}
          >
            <span
              onClick={() => {
                navigate("../");
              }}
            >
              ×
            </span>
          </button>
          <form method="post" onSubmit={handleSubmit(onSubmit)}>
            <div className="pb-4 pt-5 px-4 bg-white sm:p-6 sm:pb-4">
              <div className="sm:flex sm:items-start">
                <div className="mt-3 text-center sm:ml-4 sm:mt-0 sm:text-left w-full">
                  <h3
                    className="text-left text-gray-900 text-lg font-medium leading-6"
                    id="modal-title"
                  >
                    {data ? (
                      <div>
                        Rabattkod <DiscountLabel balance={data.balance} />
                      </div>
                    ) : (
                      `Ny rabattkod`
                    )}
                  </h3>
                  <div className="mt-2">
                    {/* Första raden med två fält */}
                    <div className="flex flex-col md:flex-row gap-4">
                      <div className="flex-1">
                        <label
                          htmlFor="discount-code"
                          className="block text-sm font-medium text-gray-700 text-left"
                        >
                          Rabattkod
                        </label>
                        <input
                          {...register("code")}
                          type="text"
                          name="code"
                          id="discount-code"
                          defaultValue={data && data.code}
                          className={classNames(
                            "mt-1 block w-full px-3 py-2 border rounded-md shadow-sm  sm:text-sm",
                            errors.code
                              ? "border-red-500 focus:ring-red-500 focus:border-red-500 outline outline-red-500"
                              : "border-gray-300 focus:ring-blue-500 focus:border-blue-500 outline outline-blue-500"
                          )}
                          placeholder="Rabattkod"
                        />
                      </div>
                      <div className="flex-1">
                        <label
                          htmlFor="percentage"
                          className="block text-sm font-medium text-gray-700 text-left"
                        >
                          Procent
                        </label>
                        <input
                          type="number"
                          {...register("percentage", { valueAsNumber: true })}
                          name="percentage"
                          id="percentage"
                          defaultValue={data && data.percentage}
                          className={classNames(
                            "mt-1 block w-full px-3 py-2 border rounded-md shadow-sm  sm:text-sm",
                            errors.percentage
                              ? "border-red-500 focus:ring-red-500 focus:border-red-500 outline outline-red-500"
                              : "border-gray-300 focus:ring-blue-500 focus:border-blue-500 outline outline-blue-500"
                          )}
                          placeholder="Procent"
                        />
                      </div>
                    </div>
                    {/* Andra raden med två nya fält */}
                    <div className="flex flex-col md:flex-row gap-4 mt-4">
                      <div className="flex-1">
                        <label
                          htmlFor="balance"
                          className="block text-sm font-medium text-gray-700 text-left"
                        >
                          Antal
                        </label>
                        <input
                          type="number"
                          {...register("balance", { valueAsNumber: true })}
                          name="balance"
                          id="balance"
                          defaultValue={data && data.balance}
                          className={classNames(
                            "mt-1 block w-full px-3 py-2 border rounded-md shadow-sm  sm:text-sm",
                            errors.balance
                              ? "border-red-500 focus:ring-red-500 focus:border-red-500 outline outline-red-500"
                              : "border-gray-300 focus:ring-blue-500 focus:border-blue-500 outline outline-blue-500"
                          )}
                          placeholder="Antal"
                        />
                      </div>
                      <div className="flex-1">
                        <label
                          htmlFor="expireAt"
                          className="block text-sm font-medium text-gray-700 text-left"
                        >
                          Utgångsdatum
                        </label>
                        <input
                          type="text"
                          {...register("expireAt")}
                          name="expireAt"
                          id="expireAt"
                          defaultValue={
                            data && data.expireAt
                              ? formatDateToUTC(data.expireAt)
                              : ""
                          }
                          className={classNames(
                            "mt-1 block w-full px-3 py-2 border rounded-md shadow-sm  sm:text-sm",
                            errors.expireAt
                              ? "border-red-500 focus:ring-red-500 focus:border-red-500 outline outline-red-500"
                              : "border-gray-300 focus:ring-blue-500 focus:border-blue-500 outline outline-blue-500"
                          )}
                          placeholder="ÅÅÅÅ-MM-DD HH:MM"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="px-4 py-3 bg-gray-50 sm:flex sm:flex-row-reverse sm:px-6">
              <button
                name="action"
                value="save"
                type="submit"
                className="inline-flex justify-center mb-2 px-4 py-2 w-full text-white text-base font-medium bg-blue-600 hover:bg-blue-700 border border-transparent rounded-md focus:outline-none shadow-sm focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 sm:ml-3 sm:w-auto sm:text-sm"
              >
                Spara
              </button>
              {data ? (
                <button
                  onClick={handleDelete}
                  name="action"
                  value="delete"
                  type="button"
                  className="inline-flex justify-center mb-2 px-4 py-2 w-full text-white text-base font-medium bg-red-600 hover:bg-red-700 border border-transparent rounded-md focus:outline-none shadow-sm focus:ring-2 focus:ring-red-500 focus:ring-offset-2 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Ta bort
                </button>
              ) : null}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
