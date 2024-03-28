import { ActionFunction, json, redirect } from "@remix-run/node";
import { Form, useActionData } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";
import { ZodError, z } from "zod";
import { Collections } from "~/schemas/collections";

interface ActionDataErrors {
  [key: string]: string | undefined; // or any other type that the error messages are
}

interface ActionData {
  errors?: ActionDataErrors;
}

const Collectionchema = z.object({
  headline: z.string().min(1, { message: "Var god fyll i namn" }),
  shortUrl: z.string().min(1, {
    message: "Var skriv in kort URL",
  }),
  image: z.string().min(1, {
    message: "Var god ladda upp en bild",
  }),
});

export const action: ActionFunction = async ({ request, params }) => {
  const result = {} as any;
  for (const [key, value] of await request.formData()) {
    result[key] = value;
  }

  try {
    Collectionchema.parse(result);
    const data =  {
      headline: result.headline,
      shortUrl: result.shortUrl,
      instagram: result.instagram,
      twitter: result.twitter,
      image: result.image,
      longDescription: result.longDescription,
      shortDescription: result.shortDescription
    }

    const collection = await Collections.findOne({shortUrl: result.shortUrl})
    if (collection) {
      return json({
        errors: {
          shortUrl: "short Url finns redan"
        }
      });
    }

    await Collections.updateMany(
      {},
      { $inc: { sortOrder: 1 } }
    );
    await Collections.create({
      ...data,
      sortOrder: 0
    })

    return redirect(`/`)

  } catch (e) {
    const s = e as ZodError;

    return json({
      errors: s.issues.reduce((acc, i) => {
        acc[i.path[0]] = i.message;
        return acc;
      }, {} as any),
    });
  }
};

const Collection = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState<string>("");
  const actionData = useActionData<ActionData>();
  console.log(actionData)

  useEffect(() => {
    if (actionData?.errors) {
      actionData.errors &&
        Object.keys(actionData.errors!).forEach((key) => {
          const message = actionData.errors![key];
          toast.warn(`${message}`, {
            position: "top-right",
            autoClose: 1500,
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

  useEffect(() => {
    if (fileRef && fileRef.current) {
      fileRef.current.value = image;
    }
  }, [image]);

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

      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/admin/collection/upload", {
        method: "POST",
        body: formData,
      });
      if (response.ok) {
        const jsonResponse = await response.json();
        setImage(`https://38vabcm3.twic.pics/${jsonResponse.key}`);
      }
    }

    event.target.value = "";
  };

  const handleShortUrlKeyPress = (
    event: React.KeyboardEvent<HTMLInputElement>
  ) => {
    // Allow only lowercase English letters and the backspace key (keyCode 8)
    if (
      !/^[a-z]+$/.test(event.key) &&
      event.key !== "Backspace" &&
      event.key !== "Enter" // Allow Enter key for form submission
    ) {
      event.preventDefault();
    }
  };

  return (
    <div className="mx-auto px-4 py-5 mt-20">
      <div
        className="relative w-full shadow-lg max-h-200"
        style={{
          background: image
            ? ""
            : "repeating-linear-gradient(45deg, #f0f0f0, #f0f0f0 10px, #ffffff 10px, #ffffff 20px)",
        }}
      >
        <div
          style={{ minHeight: "200px", maxHeight: "200px" }}
          className="border border-gray-300 mb-5 w-full max-h-200 rounded-t-lg object-cover object-center"
        >
          {image ? (
            <img
              src={image}
              alt="Uploaded"
              style={{ minHeight: "200px", maxHeight: "200px" }}
              className="w-full h-full object-cover rounded-t-lg"
            />
          ) : null}
          <div className="absolute bottom-2 right-2">
            {image ? (
              <button
                className="mr-2 bg-blue-500 hover:bg-blue-700 text-white font-bold p-2 rounded-full inline-flex items-center justify-center shadow-lg transform transition duration-150 ease-in-out hover:scale-110"
                style={{
                  width: "3rem",
                  height: "3rem",
                  boxShadow: "0px 0px 10px rgba(0, 0, 0, 0.5)",
                }} // Adjust the size as needed
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
                    d="M4 12h16"
                  />
                </svg>
              </button>
            ) : null}
            <button
              onClick={handleFileInputClick}
              className="bg-blue-500 hover:bg-blue-700 text-white font-bold p-2 rounded-full inline-flex items-center justify-center shadow-lg transform transition duration-150 ease-in-out hover:scale-110"
              style={{
                width: "3rem",
                height: "3rem",
                boxShadow: "0px 0px 10px rgba(0, 0, 0, 0.5)",
              }} // Adjust the size as needed
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
                  d="M12 4v16m8-8H4"
                />
              </svg>
              <input
                ref={fileInputRef}
                type="file"
                accept=".jpg, .jpeg, .heic, .png"
                onChange={handleFileChange}
                className="hidden"
              />
            </button>
          </div>
        </div>
      </div>
      <Form method="post">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3">
          <div>
            <label
              htmlFor="headline"
              className="block text-sm font-medium text-gray-700"
            >
              Namn *
            </label>

            <input
              type="text"
              required
              name="headline"
              className="focus:shadow-outline w-full appearance-none rounded border border-slate-300 bg-white py-2 px-3 leading-tight text-slate-700 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-100 focus:ring-offset-2"
              placeholder="Namn"
            />
          </div>
          <div>
            <label
              htmlFor="shortUrl"
              className="block text-sm font-medium text-gray-700"
            >
              Kort URL *
            </label>
            <input
              type="text"
              onKeyPress={handleShortUrlKeyPress} // Prevent disallowed characters
              required
              name="shortUrl"
              className="focus:shadow-outline w-full appearance-none rounded border border-slate-300 bg-white py-2 px-3 leading-tight text-slate-700 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-100 focus:ring-offset-2"
              placeholder="Kort URL"
            />
          </div>
          <div>
            <label
              htmlFor="twitter"
              className="block text-sm font-medium text-gray-700"
            >
              Twitter URL
            </label>
            <input
              type="url"
              name="twitter"
              className="focus:shadow-outline w-full appearance-none rounded border border-slate-300 bg-white py-2 px-3 leading-tight text-slate-700 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-100 focus:ring-offset-2"
              placeholder="Twitter URL"
            />
          </div>
          <div>
            <label
              htmlFor="instagram"
              className="block text-sm font-medium text-gray-700"
            >
              Instagram URL
            </label>
            <input
              type="url"
              name="instagram"
              className="focus:shadow-outline w-full appearance-none rounded border border-slate-300 bg-white py-2 px-3 leading-tight text-slate-700 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-100 focus:ring-offset-2"
              placeholder="Instagram URL"
            />
          </div>
          <div>
            <label
              htmlFor="shortDescription"
              className="block text-sm font-medium text-gray-700"
            >
              Kort beskrivning *
            </label>
            <textarea
              name="shortDescription"
              className="focus:shadow-outline w-full appearance-none rounded border border-slate-300 bg-white py-2 px-3 leading-tight text-slate-700 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-100 focus:ring-offset-2"
              placeholder="Kort beskrivning"
            ></textarea>
          </div>
          <div>
            <label
              htmlFor="longDescription"
              className="block text-sm font-medium text-gray-700"
            >
              Beskrivning
            </label>
            <textarea
              name="longDescription"
              className="focus:shadow-outline w-full appearance-none rounded border border-slate-300 bg-white py-2 px-3 leading-tight text-slate-700 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-100 focus:ring-offset-2"
              placeholder="Beskrivning"
            ></textarea>
          </div>
        </div>
        <input type="hidden" name="image" ref={fileRef} />
        <div className="flex justify-end pt-3 pb-20">
          <button
            type="submit"
            className="shadow-lg bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
          >
            Spara
          </button>
        </div>
      </Form>
    </div>
  );
};

export default Collection;
