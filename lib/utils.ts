import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** ISO timestamp -> `YYYY-MM-DD` (the day is enough for validity in the Viewer). */
export function formatDate(value: string | null | undefined): string | null {
  if (!value) return null
  return value.slice(0, 10)
}

/** ISO timestamp -> SK locale date ('15. 6. 2025') for display to users. */
export function formatLocalDate(value: string | null | undefined): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("sk-SK")
}
