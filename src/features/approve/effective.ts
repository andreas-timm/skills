import type { Config } from "@config";
import type { ApprovalStatus } from "./status";

export function approvedLocationNames(config: Config): string[] {
    return Object.entries(config.skills.locations)
        .filter(([, location]) => location.approved === true)
        .map(([name]) => name)
        .sort((a, b) => a.localeCompare(b));
}

export function effectiveApprovalStatus(
    status: ApprovalStatus | null,
    occurrenceLocations: Iterable<string>,
    approvedLocations: ReadonlySet<string>,
): ApprovalStatus | null {
    if (status !== null) {
        return status;
    }
    for (const location of occurrenceLocations) {
        if (approvedLocations.has(location)) {
            return "approved";
        }
    }
    return null;
}
