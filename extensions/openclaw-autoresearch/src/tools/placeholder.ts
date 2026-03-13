type PlaceholderResultDetails = {
  phase: "pr2-skeleton";
  status: "not_implemented";
  plannedInPr: string;
};

export function createPlaceholderToolResult(toolName: string, plannedInPr: string) {
  return {
    content: [
      {
        type: "text" as const,
        text:
          `${toolName} is registered in the PR 2 plugin skeleton but not implemented yet. ` +
          `Planned completion: ${plannedInPr}.`,
      },
    ],
    details: {
      phase: "pr2-skeleton",
      status: "not_implemented",
      plannedInPr,
    } satisfies PlaceholderResultDetails,
  };
}
