import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import chalk from "chalk";
import type { InvariantResult } from "./types.js";

export interface FacilitatorMeta {
  name: string;
  commit: string;
  chain: string;
}

export interface WardReport {
  runId: string;
  timestamp: string;
  facilitator: FacilitatorMeta;
  results: InvariantResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
}

export function buildReport(results: InvariantResult[], facilitator: FacilitatorMeta): WardReport {
  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  return {
    runId: randomUUID(),
    timestamp: new Date().toISOString(),
    facilitator,
    results,
    summary: { total: results.length, passed, failed, skipped: 0 },
  };
}

const REPORTS_DIR = "reports";

export async function writeReport(report: WardReport): Promise<{ timestampedPath: string; latestPath: string }> {
  await mkdir(REPORTS_DIR, { recursive: true });
  const safeTimestamp = report.timestamp.replace(/[:.]/g, "-");
  const timestampedPath = path.join(REPORTS_DIR, `ward-report-${safeTimestamp}.json`);
  const latestPath = path.join(REPORTS_DIR, "latest.json");
  // Invariant evidence isn't guaranteed to funnel through EvidenceCollector's own
  // BigInt-safe serialization (e.g. raw algosdk confirmation objects embedded directly),
  // so the same bigint-to-string replacer is applied here as the final safety net.
  const body = JSON.stringify(report, (_key, v) => (typeof v === "bigint" ? v.toString() : v), 2);
  await writeFile(timestampedPath, body, "utf-8");
  await writeFile(latestPath, body, "utf-8");
  return { timestampedPath, latestPath };
}

export async function readLatestReport(): Promise<WardReport> {
  const latestPath = path.join(REPORTS_DIR, "latest.json");
  let raw: string;
  try {
    raw = await readFile(latestPath, "utf-8");
  } catch {
    throw new Error(`No report found at ${latestPath}. Run "ward test" first.`);
  }
  return JSON.parse(raw) as WardReport;
}

export function renderTerminalReport(report: WardReport): string {
  const lines: string[] = [];
  lines.push(chalk.bold(`\nWard report — ${report.facilitator.name} (${report.facilitator.chain})`));
  lines.push(chalk.gray(`run ${report.runId} · ${report.timestamp}`));
  lines.push("");

  const byCategory = new Map<string, InvariantResult[]>();
  for (const r of report.results) {
    const list = byCategory.get(r.category) ?? [];
    list.push(r);
    byCategory.set(r.category, list);
  }

  for (const [category, results] of byCategory) {
    lines.push(chalk.underline(category.toUpperCase()));
    for (const r of results) {
      const badge = r.passed ? chalk.green("PASS") : chalk.red("FAIL");
      lines.push(`  ${badge}  ${chalk.bold(r.id)}  ${r.name}  ${chalk.gray(`(${r.durationMs}ms)`)}`);
      lines.push(`        ${r.evidenceSummary}`);
    }
    lines.push("");
  }

  const { total, passed, failed } = report.summary;
  const summaryColor = failed === 0 ? chalk.green : chalk.red;
  lines.push(summaryColor(chalk.bold(`${passed}/${total} passed, ${failed} failed`)));

  return lines.join("\n");
}
