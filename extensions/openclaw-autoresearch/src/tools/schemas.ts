import { Type } from "@sinclair/typebox";

const CwdParam = Type.Optional(
  Type.String({
    description:
      "Optional working directory for repo-local autoresearch state. Use this when the tool call originates outside the target repo session cwd.",
  }),
);

export const InitExperimentParams = Type.Object({
  cwd: CwdParam,
  name: Type.String({
    description:
      'Human-readable name for this experiment session (e.g. "Optimizing liquid for fastest execution and parsing")',
  }),
  metric_name: Type.String({
    description:
      'Display name for the primary metric (e.g. "total_µs", "bundle_kb", "val_bpb").',
  }),
  metric_unit: Type.Optional(
    Type.String({
      description:
        'Unit for the primary metric. Use "µs", "ms", "s", "kb", "mb", or "" for unitless. Default: "".',
    }),
  ),
  direction: Type.Optional(
    Type.String({
      description: 'Whether "lower" or "higher" is better for the primary metric. Default: "lower".',
      enum: ["lower", "higher"],
    }),
  ),
});

export const RunExperimentParams = Type.Object({
  cwd: CwdParam,
  command: Type.String({
    description: "Shell command to run (e.g. 'pnpm test:vitest', 'uv run train.py')",
  }),
  timeout_seconds: Type.Optional(
    Type.Number({
      description: "Kill after this many seconds (default: 600)",
    }),
  ),
});

export const LogExperimentParams = Type.Object({
  cwd: CwdParam,
  commit: Type.String({ description: "Git commit hash (short, 7 chars)" }),
  metric: Type.Number({
    description:
      "The primary optimization metric value (e.g. seconds, val_bpb). Use 0 for crashes.",
  }),
  status: Type.String({
    description: "Result status for this experiment.",
    enum: ["keep", "discard", "crash"],
  }),
  description: Type.String({
    description: "Short description of what this experiment tried.",
  }),
  metrics: Type.Optional(
    Type.Record(Type.String(), Type.Number(), {
      description:
        'Additional metrics to track as { name: value } pairs, e.g. { "compile_µs": 4200, "render_µs": 9800 }.',
    }),
  ),
  force: Type.Optional(
    Type.Boolean({
      description:
        "Set to true to allow adding a new secondary metric that was not tracked before.",
    }),
  ),
});
