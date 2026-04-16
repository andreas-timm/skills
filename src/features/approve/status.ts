export const APPROVAL_STATUSES = ["approved", "ignore"] as const;

export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

const APPROVAL_STATUS_SET = new Set<string>(APPROVAL_STATUSES);

export function isApprovalStatus(status: string): status is ApprovalStatus {
    return APPROVAL_STATUS_SET.has(status);
}

export function parseApprovalStatus(rawStatus: string): ApprovalStatus {
    const status = rawStatus.trim().toLowerCase();

    if (!isApprovalStatus(status)) {
        throw new Error(`Status must be one of: ${APPROVAL_STATUSES.join(", ")}.`);
    }

    return status;
}
