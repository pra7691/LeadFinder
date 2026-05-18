// Email address classification and validation utilities

const NOREPLY_PATTERNS = [
  /^noreply@/i,
  /^no-reply@/i,
  /^donotreply@/i,
  /^do-not-reply@/i,
  /^bounce@/i,
  /^mailer-daemon@/i,
  /^postmaster@/i,
];

const INVALID_PATTERNS = [
  /^example@/i,
  /^test@/i,
  /^fake@/i,
  /^spam@/i,
  /^invalid@/i,
  /example\.(com|org|net)$/i,
  /test\.(com|org|net)$/i,
];

const GENERIC_LOCAL_PARTS = [
  "info",
  "contact",
  "hello",
  "support",
  "help",
  "admin",
  "sales",
  "marketing",
  "office",
  "team",
  "mail",
  "general",
  "enquiries",
  "enquiry",
  "service",
  "services",
  "billing",
];

export type EmailType = "noreply" | "generic" | "personal" | "invalid" | "unknown";

export interface EmailValidationResult {
  email: string;
  type: EmailType;
  isRejected: boolean;
  isFlagged: boolean;
  reason?: string;
}

export function classifyEmail(email: string): EmailValidationResult {
  if (!email || !email.includes("@")) {
    return { email, type: "unknown", isRejected: false, isFlagged: true, reason: "Malformed email" };
  }

  const [localPart, domain] = email.toLowerCase().split("@");

  // Reject patterns (noreply etc.)
  for (const pattern of NOREPLY_PATTERNS) {
    if (pattern.test(email)) {
      return { email, type: "noreply", isRejected: true, isFlagged: true, reason: "No-reply address" };
    }
  }

  // Invalid patterns (example, test domains)
  for (const pattern of INVALID_PATTERNS) {
    if (pattern.test(email)) {
      return { email, type: "invalid", isRejected: true, isFlagged: true, reason: "Invalid/test email address" };
    }
  }

  // Generic local parts (info@, contact@, etc.) — flag but don't reject
  if (GENERIC_LOCAL_PARTS.includes(localPart)) {
    return { email, type: "generic", isRejected: false, isFlagged: true, reason: "Generic email address" };
  }

  // Risky domains
  const riskyTlds = [".xyz", ".top", ".click", ".loan", ".win", ".bid", ".review"];
  if (riskyTlds.some((tld) => domain.endsWith(tld))) {
    return { email, type: "unknown", isRejected: false, isFlagged: true, reason: "Risky domain TLD" };
  }

  // Looks like a personal/direct address
  return { email, type: "personal", isRejected: false, isFlagged: false };
}

export function shouldRejectEmail(email: string): boolean {
  return classifyEmail(email).isRejected;
}
