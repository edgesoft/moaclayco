import process from "node:process";

// Imports that construct external service clients validate their configuration
// immediately. Unit tests use explicit fakes and must never need real secrets.
process.env.AWS_ACCESS_KEY_ID ||= "unit-test-no-s3-access";
process.env.AWS_REGION ||= "eu-north-1";
process.env.AWS_SECRET_ACCESS_KEY ||= "unit-test-no-s3-access";
process.env.STRIPE_SRV ||= "sk_test_unit_test_placeholder";
process.env.STRIPE_API_VERSION ||= "2023-08-16";
