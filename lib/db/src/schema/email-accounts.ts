import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const emailAccountsTable = pgTable("email_accounts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  senderName: text("sender_name").notNull().default(""),
  email: text("email").notNull().unique(),
  smtpHost: text("smtp_host").notNull(),
  smtpPort: integer("smtp_port").notNull().default(587),
  smtpSecure: boolean("smtp_secure").notNull().default(false),
  smtpUser: text("smtp_user").notNull(),
  smtpPassword: text("smtp_password").notNull(),
  dailySendLimit: integer("daily_send_limit").notNull().default(50),
  isActive: boolean("is_active").notNull().default(true),
  totalSent: integer("total_sent").notNull().default(0),
  sentToday: integer("sent_today").notNull().default(0),
  lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
  lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
  lastTestResult: text("last_test_result"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertEmailAccountSchema = createInsertSchema(
  emailAccountsTable,
).omit({ id: true, createdAt: true, updatedAt: true, totalSent: true, sentToday: true, lastSentAt: true, lastTestedAt: true, lastTestResult: true });
export type InsertEmailAccount = z.infer<typeof insertEmailAccountSchema>;
export type EmailAccount = typeof emailAccountsTable.$inferSelect;
