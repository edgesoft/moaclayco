import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCart } from "react-use-cart";
import { AnimatePresence, motion } from "framer-motion";
import { MetaFunction, useFetcher } from "@remix-run/react";

import Loader from "~/components/loader";
import { HashLink } from "react-router-hash-link";

import { Items } from "../schemas/items";
import { Orders } from "../schemas/orders";
import { Discounts } from "~/schemas/discounts";
import { classNames } from "~/utils/classnames";
import { FREE_FREIGHT } from "~/utils/constants";
import getFreightCost from "~/utils/getFreightCost";
import useStickyState from "../hooks/useStickyState";
import Feedback from "../components/feedback";
import { ActionFunction, createCookie, json, redirect } from "@remix-run/node";
import React from "react";
import ClientOnly from "~/components/ClientOnly";

export let meta: MetaFunction = () => {
  return [
    {
      title: "Moa Clay Collection",
    },
    {
      name: "description",
      content: "Moa Clay Collection",
    },
  ];
};

type Id = {
  id: string;
};

enum ItemError {
  PRICE,
  BALANCE,
}

type ErrorItemVal = {
  [key: string]: {
    error: string;
    clientValue: string;
    serverValue: string;
    type: ItemError;
  };
};

const getDiscount = (percentage: number, cartTotal: number): number => {
  return Math.round(cartTotal * (percentage / 100));
};

export let action: ActionFunction = async ({ request }) => {
  let body = new URLSearchParams(await request.text());

  const data = JSON.parse(body.get("items") || "");
  const [items, discount] = await Promise.all([
    Items.find(
      { _id: { $in: data.filter((d:any) => !d.parentId).map((d: Id) => d.id) } },
      { amount: 1, price: 1 }
    ),
    Discounts.findOne({ code: body.get("discount") }),
  ]);

  if (items.length !== data.filter((d:any) => !d.parentId).length) {
    return json({
      key: new Date().getTime(),
      errors: {
        items: true,
        message: "Artiklar är borttagna. Var god ladda om!",
      },
    });
  }

  const itemErrors = items.reduce<ErrorItemVal>((acc, item) => {
    const s = data.filter((d:any) => !d.parentId).find((d: Id) => d.id === item.id);
    if (s.price !== item.price) {
      acc[s.id] = {
        error: `Priset är uppdaterat`,
        clientValue: `${s.price}`,
        serverValue: `${item.price}`,
        type: ItemError.PRICE,
      };
    }

    if (s.quantity > item.amount) {
      acc[s.id] = {
        error: `Saldot överstiger`,
        clientValue: `${s.quantity}`,
        serverValue: `${item.amount}`,
        type: ItemError.BALANCE,
      };
    }
    return acc;
  }, {});

  if (Object.keys(itemErrors).length > 0)
    return json({
      key: new Date().getTime(),
      errors: {
        items: itemErrors,
        message: itemErrors[Object.keys(itemErrors)[0]].error,
      },
    });

  const totalSum = data.reduce((acc: number, item: any) => {
    acc += item.price * item.quantity;
    return acc;
  }, 0);

  const freightCost = getFreightCost(totalSum);

  const cookie = createCookie("order", {
    maxAge: 604_800, // one week
  });

  let discountData = { amount: 0 };

  if (discount && discount.percentage && !discount.used) {
    discountData = {
      ...discount.toObject(),
      amount: getDiscount(totalSum, discount.percentage),
    };
  }



  const mappedItems = data.filter((item:any) => !item.parentId).map((item: any) => {
    return {
      itemRef: item.id,
      name: item.headline,
      price: item.price,
      quantity: item.quantity,
      additionalItems: data.filter((a:any) => a.parentId === item.id).map((a:any) => {
        return {
          name: a.headline,
          price: a.price,
          packinfo: `Till artikel ${a.index + 1}`
        }
      })
    };
  });

  const orderData = {
    items: mappedItems,
    status: "OPENED",
    customer: {
      firstname: body.get("firstname"),
      lastname: body.get("lastname"),
      postaddress: body.get("postaddress"),
      zipcode: body.get("zipcode"),
      city: body.get("city"),
      email: body.get("email"),
    },
    totalSum: totalSum + freightCost - discountData.amount,
    freightCost,
    discount: discountData,
  };
  let order = undefined;
  let value = (await cookie.parse(request.headers.get("Cookie"))) || "";
  if (value) {
    order = await Orders.findOne({ _id: value });
    if (order) {
      await Orders.updateOne(
        { _id: value },
        {
          updatedAt: new Date(),
          ...orderData,
        }
      );
    }
  }
  if (!order) {
    order = await Orders.create({
      createdAt: new Date(),
      ...orderData,
    });
  }

  return redirect(`/checkout?order=${order._id}`, {
    headers: {
      "Set-Cookie": await cookie.serialize(order._id),
    },
  });
};

const scrollToTop = () => {
  try {
    window.scroll({
      top: 0,
      left: 0,
      behavior: "auto",
    });
  } catch (error) {
    window.scrollTo(0, 0);
  }
};

type InputProps = {
  name: string;
  placeholder: string;
};

const Input: React.FC<InputProps> = ({ name, placeholder }): JSX.Element => {
  const [value, setValue] = useStickyState("", name);
  const [invalid, setInvalid] = useState(false);

  return (
    <input
      type="text"
      name={name}
      value={value}
      required={true}
      onInvalid={() => {
        setInvalid(true);
      }}
      onChange={(e) => {
        setValue(e.target.value);
      }}
      className={classNames(
        "focus:shadow-outline px-3 py-2 w-full text-gray-700 leading-tight border rounded focus:outline-none appearance-none",
        invalid ? "border-red-400" : ""
      )}
      placeholder={placeholder}
    />
  );
};

const userDiscount = (code: string) => {
  let fetcher = useFetcher();
  useEffect(() => {
    let handler = setTimeout(() => {
      fetcher.submit({ code }, { action: "/discount", method: "post" });
    }, 300);

    return () => {
      clearTimeout(handler);
    };
  }, [code]);

  return { code, percentage: null, used: false, ...fetcher.data };
};

const getLastError = (data: any): string | undefined => {
  if (!data) return undefined;
  if (!data.errors) return undefined;
  return data.errors.message;
};




function Cart() {
  const { items, updateItemQuantity, cartTotal, removeItem } = useCart();
  let cartFetcher = useFetcher();
  let ref = useRef(null);
  let navigation = useNavigate();
  const [value, setValue] = useState<string>("");
  const { code, percentage } = userDiscount(value);

  const hasItemsError = () =>
    cartFetcher.data &&
    cartFetcher.data.errors &&
    cartFetcher.data.errors.items;

  const hasItemError = (key: string) =>
    cartFetcher.data &&
    cartFetcher.data.errors &&
    cartFetcher.data.errors.items &&
    cartFetcher.data.errors.items[key];

  useEffect(() => {
    scrollToTop();
  }, []);

  useEffect(() => {
    if (hasItemsError()) {
      scrollToTop();
    }
  }, [cartFetcher]);

  useEffect(() => {
    if (cartTotal === 0) {
      navigation("/");
    }
  }, [cartTotal]);

  const freightCost = getFreightCost(cartTotal);

  const additionalData = (item) => {
    const data = items.reduce((acc, additionalItem) => {
      if (
        additionalItem.parentId === item.id &&
        additionalItem.parentId.includes(item.id)
      ) {
        const part = additionalItem.id.split("_");
        const key = `${item.id}_${part[2]}`;
        if (acc[key]) {
          acc[key].balance += 1; 
        } else {
          acc[key] = {
            id: key,
            name: additionalItem.headline,
            balance: 1,
            price: additionalItem.price,
          };
        }
      }
      return acc;
    }, {});

    return Object.keys(data).length > 0 ? (
      <>
        {Object.values(data).map((d, index) => {
          const cl =
            index === Object.keys(data).length - 1 ? "border-b py-10" : "";
          return (
            <tr key={d.id} className={`${cl} border-gray relative`}>
              <td className="px-2 py-2  text-sm">
                {" "}
                {/* Adjust the colSpan as needed */}
                <div className="flex items-center">
                  <div className="flex-shrink-0 w-12 md:w-20"></div>
                  <div className="ml-4">
                    <div className="flex-wrap text-gray-900 text-xs">
                      {d.name}
                    </div>
                  </div>
                </div>
              </td>
              <td className="px-2 whitespace-nowrap">
                <span className="inline-flex px-2 text-xs font-semibold leading-5 rounded-full text-green-800 bg-green-100">
                  {d.balance}
                </span>
              </td>
              <td className="px-2 text-gray-500 whitespace-nowrap text-xs">
                {d.price}
              </td>
              <td></td>
            </tr>
          );
        })}
      </>
    ) : (
      <tr className="border-b border-gray">
        <td></td>
      </tr>
    );
  };

  return (
    <cartFetcher.Form ref={ref} method="post">
      <div className="flex flex-col mt-20 pl-1 pr-1 pt-4">
        {cartTotal > 0 ? (
          <div className="grid gap-2 grid-cols-1 lg:grid-cols-2">
            <div className="overflow auto">
              <div className="inline-block align-middle p-3 py-2 min-w-full">
                <div className="min-w-full border-b border-gray-200 shadow overflow-hidden sm:rounded-lg">
                  <table className="min-w-full divide-gray-200 divide-y">
                    <thead className="bg-gray-50">
                      <tr>
                        <th
                          scope="col"
                          className="flex-wrap px-2 py-3 text-left text-gray-500 text-xs font-medium uppercase"
                        >
                          Namn
                        </th>
                        <th
                          scope="col"
                          className="px-2 py-3 text-left text-gray-500 text-xs font-medium tracking-wider uppercase"
                        >
                          Antal
                        </th>
                        <th
                          scope="col"
                          className="px-2 py-3 text-left text-gray-500 whitespace-nowrap text-xs font-medium tracking-wider uppercase"
                        >
                          St pris
                        </th>
                        <th scope="col" className="relative px-1 py-3">
                          <span className="sr-only">Edit</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white">
                      {items.map((item) => {
                        if (item.parentId) return null;
                        const error = hasItemError(item.id);

                        return (
                          <React.Fragment key={item.id}>
                            <tr onClick={() => {}}>
                              <td className="px-2 py-4">
                                <HashLink
                                  to={`/collections/${item.collectionRef}#${item.id}`}
                                >
                                  <div className="flex items-center">
                                    <div className="flex-shrink-0 w-12 h-12 md:w-20 md:h-20">
                                      <img
                                        className="w-full h-full rounded-full object-cover object-center"
                                        src={item.image}
                                        alt=""
                                      />
                                    </div>
                                    <div className="ml-4">
                                      <div className="flex-wrap text-gray-900 text-sm font-medium border-b-2 border-dashed border-gray-300">
                                        {item.headline}
                                      </div>
                                      {(error &&
                                        error.type === ItemError.BALANCE) ||
                                      item.balance < (item.quantity || 0) ? (
                                        <div>
                                          <div className="p-0.5 text-red-800 text-sm bg-red-100 rounded">
                                            Max{" "}
                                            {error
                                              ? error.serverValue
                                              : item.balance}{" "}
                                            st
                                          </div>
                                        </div>
                                      ) : null}
                                    </div>
                                  </div>
                                </HashLink>
                              </td>
                              <td className="px-2 py-4 whitespace-nowrap">
                                <span
                                  className={classNames(
                                    "inline-flex px-2 text-xs font-semibold leading-5 rounded-full",
                                    (error &&
                                      error.type === ItemError.BALANCE) ||
                                      item.balance < (item.quantity || 0)
                                      ? "text-red-800 bg-red-100"
                                      : "text-green-800 bg-green-100"
                                  )}
                                >
                                  {item.quantity}
                                </span>
                              </td>
                              <td
                                className={classNames(
                                  "px-2 py-4 text-gray-500 whitespace-nowrap text-sm",
                                  error && error.type === ItemError.PRICE
                                    ? "text-red-800"
                                    : ""
                                )}
                              >
                                {item.price}
                              </td>
                              <td className="px-1 py-4 text-right whitespace-nowrap text-base font-medium">
                                <button
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();

                                    const index = item.quantity - 1
                                    const additionalItems = items.filter(i => i.parentId === item.id && i.index === index)

                                    if (additionalItems && additionalItems.length > 0) {

                                      additionalItems.forEach(item => {
                                        removeItem(item.id)
                                      })
                                      
                                    }
                                   
                                    updateItemQuantity(
                                      item.id,
                                      (item.quantity || 0) - 1
                                    );
                                  }}
                                  className="px-2 py-0 text-gray-700 hover:text-indigo-900 bg-rosa rounded md:px-4 md:py-1 md:text-lg"
                                >
                                  -
                                </button>
                              
                              </td>
                            </tr>
                            {additionalData(item)}
                          </React.Fragment>
                        );
                      })}
                      <tr>
                        <td className="px-2 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="flex-shrink-0 w-12 h-12 md:w-20 md:h-20"></div>
                            <div className="ml-4">
                              <div className="text-gray-900 text-sm font-medium">
                                Frakt
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-2 py-4 whitespace-nowrap">
                          <span
                            className={classNames(
                              "inline-flex px-2 text-green-800 text-xs font-semibold leading-5 bg-green-100 rounded-full"
                            )}
                          >
                            1
                          </span>
                        </td>
                        <td className="px-2 py-4 text-gray-500 whitespace-nowrap text-sm">
                          {freightCost === 0 ? "Fri frakt" : freightCost}
                        </td>
                        <td className="px-2 py-4 text-right whitespace-nowrap text-base font-medium"></td>
                      </tr>
                    </tbody>
                  </table>
                  <div className="flex flex-row-reverse flex-grow mb-2 px-2">
                    <div className="flex flex-col">
                      <div className="flex flex-col items-end">
                        <input
                          onChange={(e) => {
                            setValue(e.target.value);
                          }}
                          name="discount"
                          type="text"
                          style={{ width: 100 }}
                          placeholder="Rabattkod"
                          className={classNames(
                            "focus:shadow-outline px-3 py-2 w-full text-gray-700 leading-tight border rounded focus:outline-none appearance-none",
                            code && !percentage ? "border-red-400" : ""
                          )}
                        />
                        <AnimatePresence>
                          {code && percentage ? (
                            <motion.div
                              exit={{ opacity: 0 }}
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              transition={{ ease: "easeInOut", duration: 0.3 }}
                              className="mt-1 p-0.5 text-green-800 text-sm bg-green-100 rounded"
                            >
                              {percentage}% (
                              {getDiscount(percentage, cartTotal)} SEK)
                            </motion.div>
                          ) : null}
                        </AnimatePresence>
                      </div>
                      <div className="lg:mb-20">
                        Totalt:{" "}
                        {cartTotal +
                          freightCost -
                          getDiscount(percentage, cartTotal)}{" "}
                        SEK
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <div className="inline-block align-middle p-3 py-2 min-w-full">
                <div className="mb-20 border-b border-gray-200 shadow overflow-hidden sm:rounded-lg">
                  <div className="p-2 bg-gray-50">
                    <div className="mb-1 text-gray-700 text-xl">
                      Leveransadress
                    </div>

                    <div className="mt-2">
                      <label>Förnamn</label>
                      <Input name="firstname" placeholder="Förnamn" />
                    </div>
                    <div className="mt-2">
                      <label className="text-base">Efternamn</label>
                      <Input name="lastname" placeholder="Efternamn" />
                    </div>
                    <div className="mt-2">
                      <label className="text-base">Epost</label>
                      <Input name="email" placeholder="Epost" />
                    </div>
                    <div className="mt-2">
                      <label className="text-base">Postadress</label>
                      <Input name="postaddress" placeholder="Postaddress" />
                    </div>
                    <div className="flex mt-2">
                      <div className="w-1/3">
                        <label className="">Postnummer</label>
                        <Input name="zipcode" placeholder="Postnr" />
                      </div>
                      <div className="pl-2 w-2/3">
                        <label className="">Ort</label>
                        <Input name="city" placeholder="Ort" />
                      </div>
                    </div>
                    <div className="flex flex-row-reverse flex-grow my-4">
                      <input
                        type="hidden"
                        name="items"
                        value={JSON.stringify(items)}
                      />
                      <button
                        disabled={cartFetcher.state !== "idle"}
                        className="p-2 text-gray-800 hover:text-white font-medium hover:bg-gray-500 bg-rosa rounded"
                      >
                        Till betalningen
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <Feedback
              forceInvisble={cartTotal >= FREE_FREIGHT}
              type="success"
              onHandleClick={() => {
                navigation("/");
              }}
              headline={`Köp för ${
                FREE_FREIGHT - cartTotal
              } till och du får fri frakt`}
              message="Titta på fler kollektioner"
            />
          </div>
        ) : null}
      </div>
      <Feedback
        forceInvisble={!cartFetcher.data}
        key={cartFetcher.data && cartFetcher.data.key}
        type="error"
        message={getLastError(cartFetcher.data)}
        headline="Fel i formulär"
        visibleInMillis={3000}
      />

      <Loader transition={cartFetcher} />
    </cartFetcher.Form>
  );
}


export default function Index(){
  return  <ClientOnly fallback={null}>{() => <Cart />}</ClientOnly>
}
