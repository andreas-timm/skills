import type { CliOptionItem } from "@andreas-timm/cli";
import { APPROVAL_STATUSES } from "./status";

export type ApproveOptions = {
    status?: string;
    rating?: string | number;
    tags?: string;
    note?: string;
    json?: boolean;
};

export type HelpPrinter = {
    outputHelp(): void;
};

export const APPROVE_COMMAND_OPTIONS = [
    {
        rawName: "--status <string>",
        description: `Approval status (${APPROVAL_STATUSES.join(", ")})`,
    },
    {
        rawName: "--rating <n>",
        description: "Approval rating from 1 to 10",
    },
    {
        rawName: "--tags <list>",
        description: "Comma-separated approval tags",
    },
    {
        rawName: "--note <text>",
        description: "Free-text approval note",
    },
    {
        rawName: "--json",
        description: "Emit the updated approval row as JSON",
    },
] as const satisfies readonly CliOptionItem[];
