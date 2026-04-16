import { format } from "date-fns";

const FORMAT = "yyyy-MM-dd HH:mm";

export function formatDateUtc(value: string | null | undefined): string {
    if (!value) return "-";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    const shifted = new Date(d.getTime() + d.getTimezoneOffset() * 60_000);
    return format(shifted, FORMAT);
}
