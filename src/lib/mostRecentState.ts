import { supabase } from "./supabase";
import type { AppState } from "../types";

/**
 * Premium: persist most recent state (requires active session).
 * All queries use maybeSingle()/upsert with onConflict to be robust.
 */

export async function saveMostRecentState(
  userId: string,
  state: AppState,
  isPremium: boolean,
): Promise<boolean> {
  if (!userId || !isPremium) return false;

  // trim user/subscription
  const toSave = {
    version: "1.0",
    timestamp: new Date().toISOString(),
    guests: state.guests,
    tables: state.tables.map((t) => ({ id: t.id, seats: t.seats, name: t.name })),
    constraints: state.constraints,
    adjacents: state.adjacents,
    assignments: state.assignments,
    seatingPlans: state.seatingPlans,
    currentPlanIndex: state.currentPlanIndex,
    userSetTables: state.userSetTables,
  };

  // ensure row; upsert on user_id
  const { error } = await supabase
    .from("recent_session_states")
    .upsert({ user_id: userId, data: toSave }, { onConflict: "user_id" });

  if (error) {
    if ((error as any).status === 401) {
      throw new Error("Your session has expired. Please log in again.");
    }
    throw new Error("Failed to save most recent state: " + error.message);
  }
  return true;
}

export async function getMostRecentState(userId: string): Promise<AppState | null> {
  if (!userId) return null;

  const { data, error } = await supabase
    .from("recent_session_states")
    .select("data, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    if ((error as any).status === 401) {
      throw new Error("Session expired. Please log in again.");
    }
    throw new Error("Failed to retrieve your most recent state: " + error.message);
  }

  if (!data || !data.data) return null;

  const required = ["guests", "tables", "constraints", "adjacents", "assignments"];
  const missing = required.filter((k) => !(k in data.data));
  if (missing.length) {
    throw new Error("Your recent state data appears incomplete or corrupted.");
  }

  return data.data as AppState;
}

export async function clearMostRecentState(
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  if (!userId) return { success: false, error: "No user ID provided" };

  const { error } = await supabase.from("recent_session_states").delete().eq("user_id", userId);
  if (error) {
    if ((error as any).status === 401) return { success: false, error: "Session expired" };
    return { success: false, error: error.message };
  }
  return { success: true };
}