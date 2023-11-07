import { ActionFunction, LoaderFunction, json } from "@remix-run/node";
import { auth } from "~/services/auth.server";
import { sessionStorage } from "../services/session.server";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import useLocalStorage from "~/hooks/useLocalStorage";
import { useEffect, useRef, useState } from "react";
import { DropDown } from "~/components/dropdown";
import { classNames } from "~/utils/classnames";
import ClientOnly from "~/components/ClientOnly";

const options = [
  { value: "Längd", label: "Längd" },
  { value: "Bredd", label: "Bredd" },
  { value: "Vikt", label: "Vikt" },
  { value: "Storlek", label: "Storlek" },
  { value: "Diameter", label: "Diameter" },
  { value: "Höjd", label: "Höjd" },
  { value: "lackad med resin", label: "Lackad", noValue: true },
];

export const action: ActionFunction = async ({ request }) => {
  let body = new URLSearchParams(await request.text());

  const data = body.get("productInfos") || "";
  console.log(data);

  return null;
};

// pass name to the info to be set in hidden

function ProductInfo() {
  const inputRef = useRef();
  const dataRef = useRef();
  const [selectValue, setSeletValue] = useState(null);
  const [inputValue, setInputValue] = useState(null);
  const [productInfos, setProductInfos] = useState([]);

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
  {/* Dropdown full width on large screens, and on its own row on small/medium screens */}
  <div className="w-full lg:flex-grow px-2 py-2">
    <DropDown
      required={true}
      label={"Typ"}
      options={options}
      isMulti={false}
      currentOptions={[]}
      onChange={(data) => {
        inputRef.current.placeholder = data.label ? data.label : "Värde";
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
    required
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
        setProductInfos([...productInfos, { name: selectValue, value: inputValue }]);
      }
    }}
    className={classNames(
      `flex-none px-4 py-2 text-sm rounded-r border border-l-0 border-slate-300 bg-blue-500 text-white hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-emerald-100 focus:ring-offset-2`,
      selectValue && inputValue ? "bg-blue-500 text-white" : "bg-gray-400 text-gray-500"
    )}
  >
    Lägg till
  </button>
</div>

</li>



            {productInfos.map((info, index) => (
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

function FileUpload() {
  const [images, setImages] = useState([]);
  const fileInputRef = useRef();

  const handleFileInputClick = () => {
    fileInputRef.current.click(); // Programmatically click the hidden file input
  };

  const handleFileChange = async (event) => {
    if (event.target.files.length > 0) {
      const file = event.target.files[0];

      event.preventDefault();

      setImages([...images, { name: file.name, thumbnail: "" }]);
      const formData = new FormData();
      formData.append("file", file);
      formData.append("collectionRef", "summer");

      // Replace '/upload' with the path to your Remix action
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
        console.log("File uploaded successfully");
      } else {
        console.error("File upload failed");
      }
      console.log(file);
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
                accept=".jpg, .jpeg, .heic"
                onChange={handleFileChange}
                className="hidden" // This hides the file input
              />
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
                    onClick={() => {}}
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

export default function Item() {
  return (
    <Form method="post">
      <div className="flex flex-col lg:flex-row gap-4 mt-20 p-2">
        {/* This div will take half the width on large screens */}
        <div className="lg:flex lg:flex-col lg:w-1/2">
          {/* Allmänt section */}
          <div className="bg-white rounded-md shadow-md w-full">
            <div className="px-2 py-2 bg-gray-50 rounded-t-lg">
              <h1 className="text-xl font-semibold text-gray-700">Allmänt</h1>
            </div>
            <div className="flex flex-wrap">
              <div className="px-2 py-2 w-full md:w-1/2">
                <input
                  required
                  name="headline"
                  placeholder="Namn"
                  type="text"
                  className="focus:shadow-outline w-full appearance-none rounded border border-slate-300 bg-white py-2 px-3 leading-tight text-slate-700 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-100 focus:ring-offset-2"
                />
              </div>
              <div className="px-2 py-2 w-full md:w-1/2">
                <input
                  required
                  name="amount"
                  placeholder="Antal"
                  type="number"
                  className="focus:shadow-outline w-full appearance-none rounded border border-slate-300 bg-white py-2 px-3 leading-tight text-slate-700 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-100 focus:ring-offset-2"
                />
              </div>
            </div>
            {/* Another Single Input Row */}
            <div className="flex flex-wrap">
              <div className="px-2 py-2 w-full md:w-1/2">
                <input
                  required
                  name="price"
                  placeholder="Pris"
                  type="number"
                  className="focus:shadow-outline w-full appearance-none rounded border border-slate-300 bg-white py-2 px-3 leading-tight text-slate-700 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-100 focus:ring-offset-2"
                />
              </div>
              <div className="px-2 py-2 w-full md:w-1/2">
                <input
                  required
                  name="instagram"
                  placeholder="Instagram"
                  type="text"
                  className="focus:shadow-outline w-full appearance-none rounded border border-slate-300 bg-white py-2 px-3 leading-tight text-slate-700 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-100 focus:ring-offset-2"
                />
              </div>
            </div>
          </div>
        </div>

        {/* This div will also take half the width on large screens and contain ProductInfo and Bilder */}
        <div className="lg:flex lg:flex-col lg:w-1/2">
          {/* ProductInfo section */}
          <div className="w-full mb-5">
            <ClientOnly fallback={null}>{() => <ProductInfo />}</ClientOnly>
          </div>
          {/* Bilder section */}
          <div className="w-full">
            <FileUpload />
          </div>
        </div>
      </div>
    </Form>
  );
}
