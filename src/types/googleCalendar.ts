export interface GoogleCalendarConnection {
  id: string;
  user_id: string;
  google_email?: string | null;
  access_token: string;
  refresh_token?: string | null;
  token_type?: string | null;
  scope?: string | null;
  expires_at?: string | null;
  created_at: string;
  updated_at: string;
}
