import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (value: number) => String(value).padStart(2, "0");

// Calendar dates are stored as YYYY-MM-DD; show them the way people write them ("28 Sep 2026").
export function formatDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
}

// Timestamps are stored as UTC ISO strings; show them in the viewer's local time zone.
export function formatLocalDate(iso: string): string {
  const date = new Date(iso);
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

// Quantities and kg CO₂e: "3,105.13", never more than two decimals.
export const formatAmount = (value: number) => value.toLocaleString("en-GB", { maximumFractionDigits: 2 });
export const formatUsd = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return `${formatLocalDate(iso)}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Better Auth's sign-in length rule, which the Accounts page also asks of a password an Admin types.
export const PASSWORD_MIN = 12;

// A password a person can read out or retype: 16 characters with no look-alikes (0/o, 1/l/i), in groups of four, about
// 79 bits. Bytes from 248 up are skipped, so every character is equally likely.
export function readablePassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let password = "";
  while (password.length < 16) for (const byte of crypto.getRandomValues(new Uint8Array(32))) if (byte < 248 && password.length < 16) password += alphabet[byte % alphabet.length];
  return password.match(/.{4}/g)!.join("-");
}
