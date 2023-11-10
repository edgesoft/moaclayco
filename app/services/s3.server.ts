import { S3Client } from "@aws-sdk/client-s3";

const awsRegion = process.env.AWS_REGION;
const awsAccessKeyId = process.env.AWS_ACCESS_KEY_ID;
const awsSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

if (!awsRegion || !awsAccessKeyId || !awsSecretAccessKey ) {
  throw new Error("AWS configuration is not complete. Please check your environment variables.");
}

export const s3Client = new S3Client({
  region: awsRegion,
  credentials: {
    accessKeyId: awsAccessKeyId,
    secretAccessKey: awsSecretAccessKey,
  },
});