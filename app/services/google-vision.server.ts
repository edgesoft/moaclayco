import vision from "@google-cloud/vision";

const credentialsBase64 = process.env.GOOGLE_CREDENTIALS_BASE64;
if (!credentialsBase64) {
  throw new Error("GOOGLE_CREDENTIALS_BASE64 is undefined.");
}
// Dekoda och parsa autentiseringsuppgifterna
const credentials = JSON.parse(
  Buffer.from(credentialsBase64, "base64").toString()
);

const visionClient = new vision.ImageAnnotatorClient({
  credentials: {
    client_email: credentials.client_email,
    private_key: credentials.private_key,
  },
  projectId: credentials.project_id,
});

export default visionClient;
