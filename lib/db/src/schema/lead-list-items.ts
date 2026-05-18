import {
  pgTable,
  serial,
  integer,
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
    leadId: integer("lead_id")
      .notNull()
      .references(() => leadsTable.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("lead_list_items_unique").on(t.listId, t.leadId)],
);

export type LeadListItem = typeof leadListItemsTable.$inferSelect;
