export type MeetingSource = "bot" | "upload" | "live";

export type MeetingStatus =
  | "scheduled"
  | "joining"
  | "recording"
  | "processing"
  | "ready"
  | "failed";

export type SummaryTemplate =
  | "general"
  | "sales_discovery"
  | "customer_interview"
  | "standup"
  | "all_hands";

export const TEMPLATE_LABELS: Record<SummaryTemplate, string> = {
  general: "General",
  sales_discovery: "Sales discovery",
  customer_interview: "Customer interview",
  standup: "Standup",
  all_hands: "All-hands",
};

export interface Meeting {
  id: string;
  user_id: string;
  title: string;
  started_at: string;
  duration_seconds: number;
  platform: string | null;
  source: MeetingSource;
  status: MeetingStatus;
  media_url: string | null;
  media_type: string | null;
  participant_count: number;
  accent: string;
  created_at: string;
}

export interface Participant {
  id: string;
  meeting_id: string;
  name: string;
  email: string | null;
  company: string | null;
  is_host: boolean;
  talk_seconds: number;
}

export interface TranscriptSegment {
  id: string;
  meeting_id: string;
  participant_id: string | null;
  speaker_name: string;
  idx: number;
  start_ms: number;
  end_ms: number;
  text: string;
}

export interface SummarySection {
  heading: string;
  bullets: { text: string; start_ms?: number | null }[];
}

export interface Summary {
  id: string;
  meeting_id: string;
  template: SummaryTemplate;
  sections: SummarySection[];
  one_liner: string | null;
  model: string | null;
  generated_at: string;
}

export interface ActionItem {
  id: string;
  meeting_id: string;
  text: string;
  owner_name: string | null;
  due_hint: string | null;
  start_ms: number | null;
  completed: boolean;
}

export interface Highlight {
  id: string;
  meeting_id: string;
  user_id: string;
  label: string | null;
  start_ms: number;
  end_ms: number;
  created_at: string;
}

export interface CalendarEvent {
  id: string;
  user_id: string;
  google_event_id: string | null;
  title: string;
  starts_at: string;
  ends_at: string;
  meeting_url: string | null;
  platform: string | null;
  attendees: { name?: string; email?: string }[];
  record_enabled: boolean;
}

export interface Share {
  id: string;
  token: string;
  meeting_id: string;
  highlight_id: string | null;
  start_ms: number | null;
  end_ms: number | null;
  view_count: number;
  created_at: string;
}
