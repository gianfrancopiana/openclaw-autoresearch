const METRIC_LINE_RE =
  /^METRIC\s+([A-Za-z0-9_.\-µ]+)\s*=\s*(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*$/;

export function parseMetricLines(output: string): Record<string, number> {
  const metrics = new Map<string, number>();

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = METRIC_LINE_RE.exec(line);
    if (!match) {
      continue;
    }

    const [, name, valueText] = match;
    const value = Number(valueText);
    if (!name || !Number.isFinite(value)) {
      continue;
    }

    metrics.set(name, value);
  }

  return Object.fromEntries(metrics.entries());
}
