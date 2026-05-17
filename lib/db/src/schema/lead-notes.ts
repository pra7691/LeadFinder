import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { leadsTable } from "./leads";

export const leadNotesTable = pgTable("lead_notes", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id")
    .notNull()
    .references(() => leadsTable.id, { onDelete: "cascade" }),
  authorName: text("author_name").notNull().default("Operator"),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertLeadNoteSchema = createInsertSchema(leadNotesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertLeadNote = z.infer<typeof insertLeadNoteSchema>;
export type LeadNote = typeof leadNotesTable.$inferSelect;
