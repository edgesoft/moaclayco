import { useState, useRef, useEffect } from "react";
import { useFetcher, useNavigate } from "@remix-run/react";
import { useLoaderData } from "@remix-run/react";
import { ActionFunction, json, LoaderFunction } from "@remix-run/node";
import { Verifications } from "~/schemas/verifications";
import { s3Client } from "~/services/s3.server";
import { Upload } from "@aws-sdk/lib-storage";
import { getDomain } from "~/utils/domain";

export const loader: LoaderFunction = async ({ params, request }) => {
  const { verificationNumber } = params;
  if (!verificationNumber)
    throw new Error(`Could not find param verificationNumber`);
  const domain = getDomain(request);
  const verification = await Verifications.findOne({
    domain: domain?.domain,
    verificationNumber: parseInt(verificationNumber),
  });

  if (!verification) {
    throw new Response("Not Found", { status: 404 });
  }

  return json({ verification });
};

export const action: ActionFunction = async ({ request, params }) => {
  const formData = await request.formData();
  const domain = getDomain(request);
  const file = formData.get("file");
  const label = formData.get("label") || `${Date.now()}-${file.name}`;
  const verificationNumber = params.verificationNumber;
  const awsVerificationsPath = process.env.AWS_VERIFICATIONS_PATH;

  if (!awsVerificationsPath) {
    throw new Error(
      "AWS configuration is not complete. Please check your environment variables."
    );
  }

  if (!file || !label || !verificationNumber) {
    return json({ error: "Missing required fields" }, { status: 400 });
  }

  try {
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const fileName = `${awsVerificationsPath}/${verificationNumber}/${Date.now()}-${file.name
      }`;

    const upload = new Upload({
      client: s3Client,
      params: {
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: fileName,
        Body: fileBuffer,
        ContentType: file.type, // Sätt rätt content type
      },
    });

    const uploadResult = await upload.done();

    await Verifications.updateOne(
      {
        verificationNumber: parseInt(verificationNumber),
        domain: domain?.domain,
      },
      {
        $push: {
          files: {
            name: label,
            path: uploadResult.Location,
          },
        },
      }
    );

    return json({ success: true, name: label, path: uploadResult.Location });
  } catch (error) {
    return json({ error: "File upload failed" }, { status: 500 });
  }
};

export default function Files() {
  const { verification } = useLoaderData(); // Hämta verifieringen och filerna
  const fetcher = useFetcher();
  const fileInputRef = useRef(null);
  const [files, setFiles] = useState(verification.files || []);
  const [label, setLabel] = useState("");
  const navigate = useNavigate();

  const handleFileInputClick = () => {
    fileInputRef.current.click();
  };

  useEffect(() => {
    if (fetcher.data && fetcher.data.success) {
      setFiles((prevFiles) => [
        ...prevFiles,
        { name: fetcher.data.name, path: fetcher.data.path },
      ]);
      setLabel(""); // Töm label efter uppladdning
    }
  }, [fetcher.data, label]);

  const handleFileChange = async (event) => {
    if (event.target.files && event.target.files.length > 0) {
      const file = event.target.files[0];
      const formData = new FormData();
      formData.append("file", file);
      formData.append("label", label);
      formData.append("verificationNumber", verification.verificationNumber);
      fetcher.submit(formData, {
        method: "post",
        action: `/admin/verifications/${verification.verificationNumber}/files`,
        encType: "multipart/form-data",
      });
    }
  };

  return (
    <div
      className="fixed z-10 inset-0 overflow-y-auto"
      aria-labelledby="modal-title"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex items-end justify-center text-center sm:block sm:p-0">
        <div className="fixed inset-0 bg-black bg-opacity-70 transition-opacity"></div>
        <span
          className="hidden sm:inline-block sm:align-middle sm:h-screen"
          aria-hidden="true"
        >
          &#8203;
        </span>
        <div className="inline-block align-bottom text-left bg-white rounded-lg shadow-xl overflow-hidden transform transition-all sm:align-middle sm:my-8 sm:w-full sm:max-w-6xl">
          <div className="bg-white px-6 py-5 sm:p-6 sm:pb-4">
            <div className="sm:flex sm:items-start ">
              <div className="text-center sm:ml-4 sm:text-left w-full">
                <h3
                  className="text-xl leading-6 font-bold text-gray-900"
                  id="modal-title"
                >
                  Filer för verifikation {verification.verificationNumber}
                </h3>

                <div className="mt-6">
                  <div className="mb-6">
                    <label
                      htmlFor="label"
                      className="block text-sm font-medium text-gray-700 mb-2"
                    >
                      Filbeskrivning/Label:
                    </label>
                    <input
                      type="text"
                      id="label"
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      className="border border-gray-300 rounded-md w-full p-2 mb-2"
                      placeholder="Ex. Kvitto från Bauhaus"
                    />

                    <button
                      onClick={handleFileInputClick}
                      className="px-4 py-2 bg-blue-600 text-white rounded-md"
                    >
                      Ladda upp fil
                    </button>
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileChange}
                      className="hidden"
                      accept="application/pdf,image/*"
                    />
                  </div>

                  {/* List uploaded files */}
                  <ul className="divide-y divide-gray-200">
                    {files.map((file, index) => (
                      <li key={index} className="py-2 flex justify-between">
                        <span>{file.name}</span>
                        <a
                          href={file.path}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-500"
                        >
                          Visa
                        </a>
                      </li>
                    ))}
                  </ul>
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
