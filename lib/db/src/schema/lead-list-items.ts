import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { leadListsTable } from "./lead-lists";
import { leadsTable } from "./leads";

export const leadListItemsTable = pgTable(
  "lead_list_items",
  {
    id: serial("id").primaryKey(),
    listId: integer("list_id")
      .notNull()
      .references(() => leadListsTable.id, { onDelete: "cascade" }),
    /** NULL for manually-added email items that have no corresponding lead record. */
    leadId: integer("lead_id")
      .references(() => leadsTable.id, { onDelete: "cascade" }),
    /** Specific email address for this list item.
     *  Always set for manual imports; set per-email when a lead has multiple emails. */
    email: text("email"),
    /** Optional company name override — used for manual imports where there is no lead record. */
    companyName: text("company_name"),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("lead_list_items_unique").on(t.listId, t.leadId, t.email)],
);

export type LeadListItem = typeof leadListItemsTable.$inferSelect;
