import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, bigint, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  verified: boolean("verified").notNull().default(false),
  verifyToken: text("verify_token").notNull().default(""),
  resetCode: text("reset_code"),
  resetCodeExpiry: bigint("reset_code_expiry", { mode: "number" }),
  createdAt: text("created_at").notNull().default(sql`now()`),
  // ── Share reward tracking ──────────────────────────────────────────────
  shareCountToday:    integer("share_count_today").notNull().default(0),
  lastShareTimestamp: bigint("last_share_timestamp", { mode: "number" }),
  lastShareDate:      text("last_share_date"),          // YYYY-MM-DD (TR timezone)
  sharedReadingIds:   text("shared_reading_ids"),        // JSON array of reading IDs
  // ── Push notifications ────────────────────────────────────────────────────
  pushToken:          text("push_token"),                 // Expo push token (ExponentPushToken[...])
});

export const insertUserSchema = createInsertSchema(users).pick({
  name: true,
  email: true,
  passwordHash: true,
  verifyToken: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
