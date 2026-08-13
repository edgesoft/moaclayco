import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const composeFile = path.join(repositoryRoot, "compose.stripe-e2e.yml");
const configuredEnvironmentFile =
  process.env.STRIPE_E2E_ENV_FILE ??
  path.join(repositoryRoot, ".env.stage.local");

const parseEnvironmentFile = async (filePath) => {
  if (!existsSync(filePath)) return {};
  const result = {};
  const contents = await readFile(filePath, "utf8");
  for (const sourceLine of contents.split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).replace(/^export\s+/, "").trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
};

const fileEnvironment = await parseEnvironmentFile(configuredEnvironmentFile);
const stripeSecretKey = process.env.STRIPE_SRV ?? fileEnvironment.STRIPE_SRV;
if (!stripeSecretKey?.startsWith("sk_test_")) {
  throw new Error(
    "Stripe E2E requires STRIPE_SRV to be a Stripe sandbox key. " +
      "Set it in the environment or in .env.stage.local."
  );
}

const stripeApiVersion =
  process.env.STRIPE_API_VERSION ??
  fileEnvironment.STRIPE_API_VERSION ??
  "2026-07-29.dahlia";
if (stripeApiVersion !== "2026-07-29.dahlia") {
  throw new Error(
    "Stripe E2E is intentionally pinned to the Dahlia migration target. " +
      `Received: ${stripeApiVersion}`
  );
}
const stripeWebhookSecretEnvironmentName = "STRIPE_WEBHOOK_DAHLIA";

const baseEnvironment = {
  ...process.env,
  STRIPE_API_VERSION: stripeApiVersion,
  STRIPE_SRV: stripeSecretKey,
  STRIPE_WEBHOOK: "whsec_stripe_e2e_startup_placeholder",
  STRIPE_WEBHOOK_ACTIVE_VERSION: stripeApiVersion,
  [stripeWebhookSecretEnvironmentName]:
    "whsec_stripe_e2e_startup_placeholder",
};
const composeArguments = ["compose", "-f", composeFile];
const redact = (value) =>
  value
    .replaceAll(stripeSecretKey, "[REDACTED_STRIPE_KEY]")
    .replace(/whsec_[A-Za-z0-9_]+/g, "[REDACTED_WEBHOOK_SECRET]");

const run = (
  command,
  arguments_,
  { capture = false, environment = baseEnvironment, quiet = false } = {}
) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd: repositoryRoot,
      env: environment,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    if (capture) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
    }
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve({ stderr, stdout });
        return;
      }
      if (!quiet && capture) {
        if (stdout) process.stderr.write(redact(stdout));
        if (stderr) process.stderr.write(redact(stderr));
      }
      reject(
        new Error(
          `${command} ${arguments_.join(" ")} failed` +
            (signal ? ` with signal ${signal}` : ` with exit code ${code}`)
        )
      );
    });
  });

const compose = (arguments_, options) =>
  run("docker", [...composeArguments, ...arguments_], options);

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const waitForListener = async (environment) => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const { stdout, stderr } = await compose(
      ["logs", "--no-color", "stripe-listener"],
      { capture: true, environment, quiet: true }
    );
    if (`${stdout}\n${stderr}`.includes("Ready!")) return;
    await sleep(500);
  }
  throw new Error("Stripe CLI listener did not become ready within 30 seconds");
};

const printDiagnosticLogs = async (environment) => {
  try {
    const { stdout, stderr } = await compose(
      [
        "logs",
        "--no-color",
        "--tail=200",
        "app",
        "mailpit",
        "mongo-init",
        "stripe-listener",
      ],
      { capture: true, environment, quiet: true }
    );
    const diagnostics = redact(`${stdout}${stderr}`);
    if (diagnostics.trim()) {
      process.stderr.write("\nStripe E2E diagnostics:\n");
      process.stderr.write(diagnostics);
    }
  } catch {
    // The original test failure is more useful than a secondary log failure.
  }
};

let activeEnvironment = baseEnvironment;
let failed = false;
try {
  console.log("Resetting the isolated Stripe E2E environment...");
  await compose(["down", "--volumes", "--remove-orphans"], { quiet: true });
  await compose(["up", "-d", "mongo-e2e", "mailpit"]);
  await compose(["run", "--rm", "mongo-init"]);

  console.log("Requesting a temporary Stripe CLI signing secret...");
  const secretResult = await compose(
    ["run", "--rm", "--no-deps", "stripe-secret"],
    { capture: true }
  );
  const webhookSecret = `${secretResult.stdout}\n${secretResult.stderr}`.match(
    /whsec_[A-Za-z0-9_]+/
  )?.[0];
  if (!webhookSecret) {
    throw new Error("Stripe CLI did not return a webhook signing secret");
  }
  activeEnvironment = {
    ...baseEnvironment,
    STRIPE_WEBHOOK: webhookSecret,
    [stripeWebhookSecretEnvironmentName]: webhookSecret,
  };

  console.log("Starting the isolated app and Stripe event listener...");
  await compose(["up", "-d", "--build", "--wait", "app"], {
    environment: activeEnvironment,
  });
  await compose(["up", "-d", "stripe-listener"], {
    environment: activeEnvironment,
  });
  await waitForListener(activeEnvironment);

  console.log("Running real Stripe sandbox webhook scenarios...");
  await compose(
    ["exec", "-T", "app", "npm", "run", "test:e2e:stripe:run"],
    { environment: activeEnvironment }
  );
  console.log("Stripe webhook E2E passed.");
} catch (error) {
  failed = true;
  await printDiagnosticLogs(activeEnvironment);
  throw error;
} finally {
  if (process.env.STRIPE_E2E_KEEP !== "1") {
    console.log("Removing the isolated Stripe E2E environment...");
    await compose(["down", "--volumes", "--remove-orphans"], {
      environment: activeEnvironment,
      quiet: !failed,
    }).catch(() => undefined);
  } else {
    console.log("STRIPE_E2E_KEEP=1; isolated containers were left running.");
  }
}
