import { readLatestReport, renderTerminalReport } from "../core/report-engine.js";

export async function runReportCommand(): Promise<void> {
  const report = await readLatestReport();
  console.log(renderTerminalReport(report));
}
