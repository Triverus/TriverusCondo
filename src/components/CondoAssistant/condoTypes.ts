import type { CondoResultItem } from './CondoResultRenderer.tsx';

export interface CondoActionExecuted {
  type: 'update_stage' | 'update_temperature' | 'update_details' | 'create_lead' | 'add_interaction' | 'search_result';
  summary: string;
  leadId?: string;
  leadName?: string;
  payload?: any;
  status: 'success' | 'warning' | 'error';
}

export interface CondoMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  actionsExecuted?: CondoActionExecuted[];
  results?: CondoResultItem[];
  suggestions?: string[];
}

export interface CondoCRMContext {
  leadsCount: number;
  hotLeadsCount: number;
  userFullName: string;
  stages: { id: string; name: string }[];
  quickLeads: Array<{
    id: string;
    name: string;
    stageName: string;
    temperature: string;
    unit_count?: number | null;
    administrator?: string | null;
    city?: string | null;
  }>;
  contacts: Array<{
    id: string;
    name: string;
    role_title?: string | null;
    phone?: string | null;
    email?: string | null;
    leadName?: string;
  }>;
  recentInteractions: Array<{
    id: string;
    leadName: string;
    interaction_type: string;
    occurred_at: string;
    notes?: string | null;
    next_follow_up_date?: string | null;
  }>;
}
