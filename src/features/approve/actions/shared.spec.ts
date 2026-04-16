import { describe, expect, it } from "bun:test";
import { parseApproveOptions } from "./shared";

function createCommand() {
    let calls = 0;

    return {
        get calls() {
            return calls;
        },
        outputHelp() {
            calls += 1;
        },
    };
}

describe("parseApproveOptions", () => {
    it("accepts ignore as a valid status", () => {
        const command = createCommand();
        const result = parseApproveOptions(command, { status: " ignore " });

        expect(result.patch.status).toBe("ignore");
        expect(result.json).toBe(false);
        expect(command.calls).toBe(0);
    });

    it("rejects unsupported statuses", () => {
        const command = createCommand();

        expect(() => parseApproveOptions(command, { status: "skip" })).toThrow(
            "Status must be one of: approved, ignore.",
        );
        expect(command.calls).toBe(0);
    });

    it("parses rating as approval metadata", () => {
        const command = createCommand();
        const result = parseApproveOptions(command, { rating: "8" });

        expect(result.patch.rating).toBe(8);
        expect(command.calls).toBe(0);
    });

    it("rejects ratings outside the approval range", () => {
        const command = createCommand();

        expect(() => parseApproveOptions(command, { rating: "11" })).toThrow(
            "Rating must be between 1 and 10.",
        );
        expect(command.calls).toBe(0);
    });
});
