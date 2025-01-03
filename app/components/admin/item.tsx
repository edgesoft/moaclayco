import {
  Form,
  useActionData,
  useFetcher,
  useLoaderData,
  useParams,
} from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { DropDown } from "~/components/dropdown";
import { classNames } from "~/utils/classnames";
import ClientOnly from "~/components/ClientOnly";
import { toast } from "react-toastify";
import { ItemLoader } from "../../loaders/item";
import { ItemAction } from "~/actions/item";
import { HashLink } from "react-router-hash-link";
import { CollectionProps, ItemProps } from "~/types";

const options = [
  { value: "Längd", label: "Längd" },
  { value: "Bredd", label: "Bredd" },
  { value: "Vikt", label: "Vikt" },
  { value: "Storlek", label: "Storlek" },
  { value: "Diameter", label: "Diameter" },
  { value: "Höjd", label: "Höjd" },
  { value: "lackad med resin", label: "Lackad", noValue: true },
];

const additionalItemOptions = [
  { value: "Sterling silver 925", label: "Sterling silver 925" },
];

export const loader = ItemLoader;
export const action = ItemAction;

function AdditionalItems() {
  const { item } = useLoaderData();
  const inputRef = useRef();
  const dataRef = useRef();
  const [selectValue, setSeletValue] = useState(null);
  const [inputValue, setInputValue] = useState(null);
  const [additionalItems, setAdditionalItems] = useState(
    item && item.additionalItems
      ? item.additionalItems.map((a) => ({ name: a.name, value: a.price }))
      : []
  );

  // sync
  useEffect(() => {
    dataRef.current.value = JSON.stringify(additionalItems);
  }, [additionalItems]);

  return (
    <div className="flex">
      <div className="relative bg-white rounded-md shadow-md w-full">
        <div className="w-full">
          <div className="flex justify-between px-2 py-2 items-center bg-gray-50 rounded-t-lg">
            <h2 className="text-xl font-semibold text-gray-700">Tillval</h2>
          </div>

          <ul className="divide-y divide-gray-300">
            <li
              key={`new`}
              className="flex flex-col lg:flex-row items-center justify-between  w-full"
            >
              <div className="w-full lg:flex-grow px-2 py-2">
                <DropDown
                  required={true}
                  label={"Tillval"}
                  options={additionalItemOptions}
                  isMulti={false}
                  currentOptions={[]}
                  onChange={(data) => {
                    inputRef.current.placeholder = data.label
                      ? `Pris för ${data.label}`
                      : "Pris";
                    if (data.noValue) {
                      inputRef.current.value = data.value;
                      setInputValue(data.value);
                    } else {
                      setInputValue("");
                      inputRef.current.value = "";
                      inputRef.current.focus();
                    }
                    setSeletValue(data.label);
                  }}
                />
              </div>

              {/* Input and button side by side on all screens */}
              <div className="flex w-full lg:flex-nowrap px-2 py-2">
                <input
                  ref={inputRef}
                  onChange={(e) => setInputValue(e.target.value)}
                  name="price"
                  placeholder="Pris"
                  type="number"
                  className="focus:shadow-outline w-full lg:flex-grow rounded-l border border-slate-300 bg-white py-2 px-3 leading-tight text-slate-700 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-100 focus:ring-offset-2 mr-2"
                />
                <input ref={dataRef} type={"hidden"} name="additionalItems" />

                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (selectValue && inputValue) {
                      setAdditionalItems([
                        ...additionalItems,
                        { name: selectValue, value: inputValue },
                      ]);
                    }
                  }}
                  className={classNames(
                    `flex-none px-4 py-2 text-sm rounded-r border border-l-0 border-slate-300 bg-blue-500 text-white hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-emerald-100 focus:ring-offset-2`,
                    selectValue && inputValue
                      ? "bg-blue-500 text-white"
                      : "bg-gray-400 text-gray-500"
                  )}
                >
                  Lägg till
                </button>
              </div>
            </li>

            {additionalItems.map((info, index) => (
              <li key={index} className="flex items-center py-2 px-2">
                <div className="flex-grow space-x-2">
                  <span
                    className={`bg-blue-500 text-white inline-flex px-2 text-xs font-semibold leading-5 rounded-full`}
                  >
                    {info.name}
                  </span>

                  <span className="font-normal text-sm bg-blue-500 text-white inline-flex px-2 text-xs font-semibold leading-5 rounded-full">
                    {info.value}
                  </span>
                </div>
                <button
                  onClick={() => {
                    additionalItems.splice(index, 1);
                    setAdditionalItems([...additionalItems]);
                  }}
                  className="ml-4 w-8 h-8 flex items-center justify-center text-gray-600 hover:text-gray-800"
                >
                  <svg
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    className="w-6 h-6"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function getProductInfo(data: String) {
  if (data.includes(":")) {
    const val = data.split(":");
    return {
      name: val[0].trim(),
      value: val[1].trim(),
    };
  } else {
    const option = options.find((a) => a.value === data.trim());
    if (option) {
      return {
        name: option.name,
        value: option.value,
        noValue: true,
      };
    }

    return {
      name: data,
      value: data,
    };
  }
}

function ProductInfo() {
  const { item } = useLoaderData();
  const inputRef = useRef();
  const dataRef = useRef();
  const [selectValue, setSeletValue] = useState(null);
  const [inputValue, setInputValue] = useState(null);
  const [productInfos, setProductInfos] = useState(
    item && item.productInfos
      ? item.productInfos.map((i) => getProductInfo(i))
      : []
  );

  // sync
  useEffect(() => {
    dataRef.current.value = JSON.stringify(productInfos);
  }, [productInfos]);

  return (
    <div className="flex">
      <div className="relative bg-white rounded-md shadow-md w-full">
        <div className="w-full">
          <div className="flex justify-between px-2 py-2 items-center bg-gray-50 rounded-t-lg">
            <h2 className="text-xl font-semibold text-gray-700">Productinfo</h2>
          </div>

          <ul className="divide-y divide-gray-300">
            <li
              key={`new`}
              className="flex flex-col lg:flex-row items-center justify-between  w-full"
            >
              <div className="w-full lg:flex-grow px-2 py-2">
                <DropDown
                  required={true}
                  label={"Typ"}
                  options={options}
                  isMulti={false}
                  currentOptions={[]}
                  onChange={(data) => {
                    inputRef.current.placeholder = data.label
                      ? data.label
                      : "Värde";
                    inputRef.current.disabled = false;

                    if (data.noValue) {
                      inputRef.current.value = data.value;
                      inputRef.current.disabled = true;
                      setInputValue(data.value);
                    } else {
                      setInputValue("");
                      inputRef.current.value = "";
                      inputRef.current.focus();
                    }
                    setSeletValue(data.label);
                  }}
                />
              </div>

              {/* Input and button side by sidea on all screens */}
              <div className="flex w-full lg:flex-nowrap px-2 py-2">
                <input
                  ref={inputRef}
                  onChange={(e) => setInputValue(e.target.value)}
                  name="value"
                  placeholder="Värde"
                  type="text"
                  className="focus:shadow-outline w-full lg:flex-grow rounded-l border border-slate-300 bg-white py-2 px-3 leading-tight text-slate-700 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-100 focus:ring-offset-2 mr-2"
                />
                <input ref={dataRef} type={"hidden"} name="productInfos" />

                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (selectValue && inputValue) {
                      const option = options.find(
                        (o) => o.label === selectValue
                      );

                      setProductInfos([
                        ...productInfos,
                        {
                          name: selectValue,
                          value: inputValue,
                          noValue: option && option.noValue ? true : false,
                        },
                      ]);
                    }
                  }}
                  className={classNames(
                    `flex-none px-4 py-2 text-sm rounded-r border border-l-0 border-slate-300 bg-blue-500 text-white hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-emerald-100 focus:ring-offset-2`,
                    selectValue && inputValue
                      ? "bg-blue-500 text-white"
                      : "bg-gray-400 text-gray-500"
                  )}
                >
                  Lägg till
                </button>
              </div>
            </li>

            {productInfos.map((info, index) => (
              <li key={index} className="flex items-center py-2 px-2">
                <div className="flex-grow space-x-1">
                  {!info.noValue ? (
                    <span
                      className={`bg-blue-500 text-white inline-flex px-2 text-xs font-semibold leading-5 rounded-full`}
                    >
                      {info.name}
                    </span>
                  ) : null}
                  <span className="font-normal text-sm bg-blue-500 text-white inline-flex px-2 text-xs font-semibold leading-5 rounded-full">
                    {info.value}
                  </span>
                </div>
                <button
                  onClick={() => {
                    productInfos.splice(index, 1);
                    setProductInfos([...productInfos]);
                  }}
                  className="ml-4 w-8 h-8 flex items-center justify-center text-gray-600 hover:text-gray-800"
                >
                  <svg
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    className="w-6 h-6"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

interface ImageInfo {
  name: string;
  thumbnail: string;
}

function FileUpload() {
  const { item } = useLoaderData();
  const fetcher = useFetcher(); // useFetcher is part of Remix's data fetching API
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  let { collection } = useParams();

  const handleDelete = async (imageName: string) => {
    // This will call an endpoint on your server that should handle the deletion from S3
    fetcher.submit(
      {
        imageName: imageName,
        collection: collection ? collection : "",
        id: item ? item._id : "",
      },
      { method: "delete", action: "/admin/upload/delete" }
    );

    // Optimistically remove the image from the state
    setImages(images.filter((image) => image.name !== imageName));
  };

  const [images, setImages] = useState<ImageInfo[]>(
    item
      ? item.images.map((i) => ({
          name: i.split("/").pop().split("?")[0],
          thumbnail: i,
        }))
      : []
  );

  useEffect(() => {
    fileRef.current.value = images.map((i) => i.thumbnail).join(",");
  }, [images]);

  const handleFileInputClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    if (event.target.files && event.target.files.length > 0) {
      const file = event.target.files[0];
      event.preventDefault();

      setImages([...images, { name: file.name, thumbnail: "" }]);
      const formData = new FormData();
      formData.append("file", file);
      formData.append("collectionRef", collection ? collection : ""); // TODO: fix the collectionRef

      const response = await fetch("/admin/upload", {
        method: "POST",
        body: formData,
      });
      if (response.ok) {
        const jsonResponse = await response.json();
        setImages([
          ...images,
          {
            name: jsonResponse.uniqueFileName,
            thumbnail: `https://38vabcm3.twic.pics/${jsonResponse.key}`,
          },
        ]);
        fileRef.current.value = images.map((i) => i.thumbnail).join(",");
      }
    }

    event.target.value = "";
  };

  return (
    <>
      <div className="flex">
        <div className="relative bg-white rounded-md shadow-md w-full">
          <div className=" w-full">
            <div className="flex justify-between px-2 py-2 items-center bg-gray-50 rounded-t-lg">
              <h1 className="text-xl font-semibold text-gray-700">Bilder</h1>

              <button
                onClick={handleFileInputClick}
                type="button"
                className="flex items-center justify-center w-10 h-10 bg-blue-500 text-white rounded-full text-lg"
              >
                +
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".jpg, .jpeg, .heic, .png, .webp"
                onChange={handleFileChange}
                className="hidden"
              />
              <input type="hidden" ref={fileRef} name="images" />
            </div>

            <ul className="divide-y divide-gray-300">
              {images.map((image, index) => (
                <li key={index} className="flex items-center py-2 px-2">
                  <div className="flex-shrink-0 w-12 h-12 md:w-18 md:h-18 bg-gray-100 rounded-full overflow-hidden">
                    {image.thumbnail ? (
                      <img
                        className="w-full h-full object-cover object-center"
                        src={image.thumbnail}
                        alt={image.name}
                      />
                    ) : (
                      <div
                        className="flex items-center justify-center w-full h-full"
                        style={{
                          borderTopColor: "transparent",
                          animation: "spin 1s linear infinite",
                        }}
                      >
                        <div className="border-4 border-blue-500 rounded-full w-3/4 h-3/4"></div>
                      </div>
                    )}
                  </div>
                  <span className="pl-4 flex-grow font-normal text-sm">
                    {image.name}
                  </span>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleDelete(image.name);
                    }}
                    className="ml-4 w-8 h-8 flex items-center justify-center text-gray-600 hover:text-gray-800"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      className="w-6 h-6"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}

interface ActionDataErrors {
  [key: string]: string | undefined; // or any other type that the error messages are
}

interface ActionData {
  errors?: ActionDataErrors;
}

type LoaderDataItemProps = {
  collection: CollectionProps,
  item: ItemProps
}

export default function ItemComponent() {
  const actionData = useActionData<ActionData>();
  const { collection, item } = useLoaderData<LoaderDataItemProps>();

  useEffect(() => {
    if (actionData?.errors) {
      actionData.errors &&
        Object.keys(actionData.errors!).forEach((key) => {
          const message = actionData.errors![key];
          toast.warn(`${message}`, {
            position: "top-right",
            autoClose: 2000,
            hideProgressBar: true,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: false,
            progress: undefined,
            theme: "dark",
          });
        });
    }
  }, [actionData]);

  const changeUrl = () => {
    return (
      <>
        <span>Ändra</span> {""}
        <HashLink to={`/collections/${collection.shortUrl}#${item._id}`}>
          <span className="ml-2 border-b-2 border-dashed border-blue-500">
            {item.headline}
          </span>
        </HashLink>
      </>
    );
  };

  return (
    <Form method="post">
      <div className="mt-20 p-2">
        <span className="inline-flex items-center px-3 py-0.5 rounded-lg text-2xl md:text-2xl lg:text-2xl font-medium bg-blue-100 text-gray-800">
          <svg
            className="mr-1.5 h-3 w-3 text-blue-500"
            fill="currentColor"
            viewBox="0 0 8 8"
          >
            <circle cx="4" cy="4" r="3" />
          </svg>
          {item ? changeUrl() : `Ny artikel / ${collection.headline}`}
        </span>
      </div>
      <div className="flex flex-col lg:flex-row gap-4 p-2">
        <div className="lg:flex lg:flex-col lg:w-1/2">
          <div className="bg-white rounded-md shadow-md w-full mb-5">
            <div className="px-2 py-2 bg-gray-50 rounded-t-lg">
              <h1 className="text-xl font-semibold text-gray-700">Allmänt</h1>
            </div>
            <div className="flex flex-wrap">
              <div className="px-2 py-2 w-full md:w-1/2">
                Namn*
                <input
                  required
                  name="headline"
                  placeholder="Namn"
                  type="text"
                  defaultValue={item ? item.headline : ""}
                  className="focus:shadow-outline w-full appearance-none rounded border border-slate-300 bg-white py-2 px-3 leading-tight text-slate-700 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-100 focus:ring-offset-2"
                />
              </div>
              <div className="px-2 py-2 w-full md:w-1/2">
                Antal*
                <input
                  required
                  name="amount"
                  placeholder="Antal"
                  type="number"
                  defaultValue={item ? item.amount : ""}
                  className="focus:shadow-outline w-full appearance-none rounded border border-slate-300 bg-white py-2 px-3 leading-tight text-slate-700 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-100 focus:ring-offset-2"
                />
              </div>
            </div>
            <div className="flex flex-wrap">
              <div className="px-2 py-2 w-full md:w-1/2">
                Pris*
                <input
                  required
                  name="itemPrice"
                  placeholder="Pris"
                  type="number"
                  defaultValue={item ? item.price : ""}
                  className="focus:shadow-outline w-full appearance-none rounded border border-slate-300 bg-white py-2 px-3 leading-tight text-slate-700 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-100 focus:ring-offset-2"
                />
              </div>
              <div className="px-2 py-2 w-full md:w-1/2">
                Instagram
                <input
                  name="instagram"
                  placeholder="Instagram"
                  type="text"
                  defaultValue={item ? item.instagram : ""}
                  className="focus:shadow-outline w-full appearance-none rounded border border-slate-300 bg-white py-2 px-3 leading-tight text-slate-700 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-100 focus:ring-offset-2"
                />
              </div>
              <div className="px-2 py-2 w-full md:w-1/2">
                Beskrivning
                <textarea
                  name="longDescription"
                  placeholder="Beskrivning"
                  defaultValue={item ? item.longDescription : ""}
                  className="focus:shadow-outline w-full appearance-none rounded border border-slate-300 bg-white py-2 px-3 leading-tight text-slate-700 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-100 focus:ring-offset-2"
                />
              </div>
            </div>
          </div>

          <ClientOnly fallback={null}>{() => <AdditionalItems />}</ClientOnly>
        </div>

        <div className="lg:flex lg:flex-col lg:w-1/2">
          <div className="w-full mb-5">
            <ClientOnly fallback={null}>{() => <ProductInfo />}</ClientOnly>
          </div>
          <div className="w-full">
            <FileUpload />
          </div>
        </div>
      </div>
      <div className="flex justify-end p-4 pb-20">
        <button
          type="submit"
          className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
        >
          Spara
        </button>
      </div>
    </Form>
  );
}
