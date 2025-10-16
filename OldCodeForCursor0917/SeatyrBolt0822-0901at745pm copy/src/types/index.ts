export interface Guest {
  name: string;
  count: number;
}

export interface Table {
  id: number;
  seats: number;
  name?: string; // Optional custom name for the table
}

export type Constraint = 'must' | 'cannot' | '';

export interface Assignment {
  name: string;
  tables: string;
}

export interface SeatingPlan {
  id: number;
  tables: TableAssignment[];
}

export interface TableAssignment {
  id: number;
  seats: Guest[];
  capacity: number;
}

export interface ValidationError {
  message: string;
  type: 'error' | 'warning';
  details?: any;
}

export interface ConstraintConflict {
  id: string;
  type: 'circular' | 'impossible' | 'capacity_violation' | 'adjacency_violation';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  affectedGuests: string[];
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
  constraints: Record<string, Record<string, 'must' | 'cannot' | ''>>;
  adjacents: Record<string, string[]>;
  assignments: Record<string, string>;
  seatingPlans: SeatingPlan[];
  currentPlanIndex: number;
  subscription: UserSubscription | null;
  user: any | null;
  userSetTables: boolean;
  loadedSavedSetting: boolean;
  timestamp?: string; // For storing when the state was saved
  isSupabaseConnected?: boolean;
  hideTableReductionNotice?: boolean; // Flag to track if table reduction notice has been dismissed
  duplicateGuests?: string[]; // List of duplicate guest names for warnings
}