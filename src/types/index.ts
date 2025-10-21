export type GuestID = string;

export interface Guest {
  id: GuestID;         // stable internal id, NOT the display name
  name: string;        // display name (may change)
  count: number;       // >= 1, whole party size
}

export interface Table {
  id: number;          // stable numeric id
  name?: string | null;
  seats: number;       // editor "capacity"
}

export interface PlanSeat {
  name: string;        // display name at render time
  partyIndex: number;  // 0..(count-1) for the original guest
  id?: GuestID; // SURGICAL ADDITION: For identifying guests in the plan by ID
}

export interface PlanTable {
  id: number;
  capacity: number;
  seats: PlanSeat[];   // length <= capacity
}

export interface SeatingPlan {
  id: number;          // unique plan id for UI nav
  tables: PlanTable[]; // sorted by table.id asc
}

export type Assignments = Record<GuestID, string>; // ID-CSV (e.g. "1,3,5")
export type ConstraintValue = 'must' | 'cannot' | '';
export type Constraints = Record<GuestID, Record<GuestID, ConstraintValue>>;
export type Adjacents = Record<GuestID, GuestID[]>; // degree <= 2

export interface ValidationError {
  type: 'error' | 'warn';
  message: string;
}

export interface ConstraintConflict {
  id: string;
  type: 'circular' | 'impossible' | 'capacity_violation' | 'adjacency_violation';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  affectedGuests: GuestID[];
}

export interface UserSubscription {
  id: string;
  user_id: string;
  stripe_customer_id?: string;
  stripe_subscription_id?: string;
  status: 'active' | 'canceled' | 'past_due' | 'trialing';
  price_id?: string;
  quantity?: number;
  cancel_at_period_end?: boolean;
  created?: string;
  current_period_start?: string;
  current_period_end: string;
  ended_at?: string | null;
  cancel_at?: string | null;
  canceled_at?: string | null;
  trial_start?: string | null;
  trial_end?: string | null;
}

export interface TrialSubscription {
  id: string;
  user_id: string;
  trial_code: string;
  start_date: string;
  expires_on: string;
  expires_at?: string;
}

export interface BetaCode {
  code: string;
  expires_on?: string;
  max_uses?: number;
  uses: number;
}

export interface AppState {
  guests: Guest[];
  tables: Table[];
  constraints: Constraints;
  adjacents: Adjacents;
  assignments: Assignments;
  seatingPlans: SeatingPlan[];
  currentPlanIndex: number;
  subscription: UserSubscription | null | undefined;
  trial: TrialSubscription | null;
  user: any | null;
  userSetTables: boolean;
  loadedSavedSetting: boolean;
  loadedRestoreDecision: boolean; // NEW: Gate for data-fetching components
  timestamp?: string; // For storing when the state was saved
  isSupabaseConnected?: boolean;
  hideTableReductionNotice?: boolean; // Flag to track if table reduction notice has been dismissed
  duplicateGuests?: string[]; // List of duplicate guest names for warnings
  assignmentSignature: string; // Stable signature for assignment changes to trigger effects
  conflictWarnings: string[]; // SURGICAL ADDITION: User-facing conflict warnings
  warnings: string[]; // Non-blocking warnings for display
  lastGeneratedSignature: string | null; // Signature of last generated plan
  lastGeneratedPlanSig: string | null; // Plan signature of last generated plan
}