import * as fs from "node:fs";
import { AUTORESEARCH_ROOT_FILES, getAutoresearchRootFilePath } from "./files.js";
import type { AutoresearchCheckpoint } from "./checkpoint.js";

export function syncAutoresearchSessionDoc(
  cwd: string,
  checkpoint: AutoresearchCheckpoint,
): void {
  const sessionDocPath = getAutoresearchRootFilePath(cwd, "sessionDoc");
  const existing = fs.existsSync(sessionDocPath) ? fs.readFileSync(sessionDocPath, "utf8") : "";
  let doc = ensureTitle(existing, checkpoint.session.name);

  doc = upsertSection(
    doc,
    "## Metrics",
    [
      `- **Primary**: ${checkpoint.session.metricName} (${checkpoint.session.metricUnit || "unitless"}, ${checkpoint.session.bestDirection} is better)`,
    ].join("\n"),
  );

  doc = upsertSection(
    doc,
    "## How to Run",
    `\`${AUTORESEARCH_ROOT_FILES.runnerScript}\` — should emit \`METRIC name=number\` lines for ${checkpoint.session.metricName}.`,
  );

  doc = upsertSection(doc, "## What's Been Tried", buildTriedSection(checkpoint));
  doc = upsertSection(doc, "## Plugin Checkpoint", buildCheckpointSection(checkpoint));

  fs.writeFileSync(sessionDocPath, `${doc.trimEnd()}\n`);
}

function ensureTitle(doc: string, sessionName: string | null): string {
  const trimmed = doc.trim();
  if (!trimmed) {
    return `# Autoresearch: ${sessionName ?? "Session"}\n`;
  }

  if (/^#\s+/m.test(trimmed)) {
    return trimmed;
  }

  return `# Autoresearch: ${sessionName ?? "Session"}\n\n${trimmed}`;
}

function upsertSection(doc: string, heading: string, body: string): string {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sectionRe = new RegExp(`(^${escapedHeading}\\n)([\\s\\S]*?)(?=^##\\s|\\Z)`, "m");
  const rendered = `${heading}\n${body.trim()}\n\n`;

  if (sectionRe.test(doc)) {
    return doc.replace(sectionRe, rendered);
  }

  return `${doc.trimEnd()}\n\n${rendered}`;
}

function buildTriedSection(checkpoint: AutoresearchCheckpoint): string {
  if (checkpoint.recentLoggedRuns.length === 0) {
    return "- No logged experiments yet.";
  }

  return checkpoint.recentLoggedRuns
    .map((run) => {
      const metricUnit = checkpoint.session.metricUnit;
      const renderedMetric =
        metricUnit && metricUnit.length > 0 ? `${run.metric}${metricUnit}` : `${run.metric}`;
      return `- #${run.run} ${run.status} ${renderedMetric} ${run.commit} — ${run.description}`;
    })
    .join("\n");
}

function buildCheckpointSection(checkpoint: AutoresearchCheckpoint): string {
  const lines = [
    `- Last updated: ${new Date(checkpoint.updatedAt).toISOString()}`,
    `- Runs tracked: ${checkpoint.session.currentRunCount} current / ${checkpoint.session.totalRunCount} total`,
    `- Baseline: ${formatMetric(checkpoint.session.currentBaselineMetric, checkpoint.session.metricUnit)}`,
    `- Best kept: ${formatMetric(checkpoint.session.currentBestMetric, checkpoint.session.metricUnit)}`,
  ];

  if (checkpoint.lastLoggedRun) {
    lines.push(
      `- Last logged run: #${checkpoint.lastLoggedRun.run} ${checkpoint.lastLoggedRun.status} ${checkpoint.lastLoggedRun.commit} — ${checkpoint.lastLoggedRun.description}`,
    );
  }

  if (checkpoint.pendingRun) {
    lines.push(
      `- Pending run awaiting log_experiment: ${checkpoint.pendingRun.command} (${formatMetric(checkpoint.pendingRun.primaryMetric, checkpoint.session.metricUnit)})`,
    );
  }

  return lines.join("\n");
}

function formatMetric(value: number | null, unit: string): string {
  if (value === null) {
    return "n/a";
  }

  return `${value}${unit}`;
}
