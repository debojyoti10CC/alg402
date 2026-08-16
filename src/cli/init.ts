import { spawnSync } from "node:child_process";
import chalk from "chalk";
import ora from "ora";
import { buildScenario } from "./setup.js";
import { sleep } from "../util/timing.js";

const HEALTH_POLL_ATTEMPTS = 30;
const HEALTH_POLL_INTERVAL_MS = 2000;

export async function runInitCommand(): Promise<void> {
  console.log(chalk.bold("ward init"));

  console.log("→ starting the self-hosted facilitator (docker compose up -d --build)...");
  const compose = spawnSync("docker", ["compose", "up", "-d", "--build"], { stdio: "inherit" });
  if (compose.status !== 0) {
    throw new Error("docker compose up failed — is Docker running? See README for manual facilitator setup.");
  }

  const { ctx, fixture, config } = buildScenario();

  const healthSpinner = ora(`waiting for the facilitator at ${config.facilitatorUrl} to become healthy...`).start();
  try {
    await waitForHealthy(config.facilitatorUrl);
    healthSpinner.succeed("facilitator is up");
  } catch (err) {
    healthSpinner.fail("facilitator never became healthy");
    throw err;
  }

  if (process.env.WARD_FUNDER_PRIVATE_KEY) {
    const fundSpinner = ora("funding test accounts with native ALGO for fees...").start();
    await ctx.chain.fundAccount(fixture.clientAccount.address, 1_000_000n);
    fundSpinner.succeed(`funded ${fixture.clientAccount.address}`);
  } else {
    console.log(
      chalk.yellow(
        "  WARD_FUNDER_PRIVATE_KEY not set — skipping automatic funding. " +
          "Fund WARD_CLIENT_PRIVATE_KEY's address manually via https://bank.testnet.algorand.network/ " +
          "and opt it into the TestNet USDC ASA before running `ward test`.",
      ),
    );
  }

  console.log("→ verifying one real payment end-to-end (this is the step that proves the facilitator actually works)...");
  const payment = await ctx.chain.buildPayment({
    from: fixture.clientAccount,
    to: fixture.payToAddress,
    amount: fixture.amount,
    asset: fixture.asset,
    facilitatorFeeAddress: fixture.facilitatorFeeAddress,
    resource: fixture.resource,
  });
  const verifyResult = await ctx.facilitator.verify(payment);
  if (!verifyResult.isValid) {
    throw new Error(
      `Manual verification payment was rejected at /verify: ${verifyResult.invalidReason} — ${verifyResult.invalidMessage}. ` +
        "Check funding, opt-in status, and .env configuration before running invariants.",
    );
  }
  const settleResult = await ctx.facilitator.settle(payment);
  if (!settleResult.success) {
    throw new Error(`Manual verification payment failed at /settle: ${settleResult.errorReason} — ${settleResult.errorMessage}`);
  }

  console.log(chalk.green(`  settled: ${settleResult.transaction}`));
  console.log(chalk.gray(`  ${ctx.chain.getExplorerLink(settleResult.transaction)}`));
  console.log(chalk.bold.green("\nward init complete — the facilitator is real, funded, and working. Run `ward test` next."));
}

async function waitForHealthy(facilitatorUrl: string): Promise<void> {
  for (let attempt = 1; attempt <= HEALTH_POLL_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${facilitatorUrl.replace(/\/+$/, "")}/supported`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await sleep(HEALTH_POLL_INTERVAL_MS);
  }
  throw new Error(`Facilitator at ${facilitatorUrl} did not become healthy after ${HEALTH_POLL_ATTEMPTS} attempts`);
}
