/**
 * GENERATED FILE — do not edit by hand.
 *
 * Regenerate after any migration:
 *   supabase gen types typescript --project-id ytrkpcryztwgflmbhfdu
 * or via the Supabase MCP `generate_typescript_types` tool.
 *
 * This is the CONSOLE's view of the schema, for typing supabase-js. The
 * worker uses `./schema.ts` (Drizzle) instead — different client, different
 * privileges, deliberately different code path. See docs/02-ARCHITECTURE.md §8.
 *
 * Note `credentials: string` on `channels`: PostgREST serialises bytea as a
 * hex string. That column is encrypted and the console has no business reading
 * or writing it — the type says string, which is not permission.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '14.5';
  };
  public: {
    Tables: {
      attachments: {
        Row: {
          blob_url: string;
          filename: string | null;
          id: string;
          message_id: string;
          mime_type: string | null;
          owner_id: string;
          size_bytes: number | null;
        };
        Insert: {
          blob_url: string;
          filename?: string | null;
          id?: string;
          message_id: string;
          mime_type?: string | null;
          owner_id: string;
          size_bytes?: number | null;
        };
        Update: {
          blob_url?: string;
          filename?: string | null;
          id?: string;
          message_id?: string;
          mime_type?: string | null;
          owner_id?: string;
          size_bytes?: number | null;
        };
      };
      channels: {
        Row: {
          created_at: string;
          credentials: string;
          display_name: string;
          external_account_id: string | null;
          id: string;
          last_error: string | null;
          owner_id: string;
          status: string;
          type: string;
        };
        Insert: {
          created_at?: string;
          credentials: string;
          display_name: string;
          external_account_id?: string | null;
          id?: string;
          last_error?: string | null;
          owner_id: string;
          status?: string;
          type: string;
        };
        Update: {
          created_at?: string;
          credentials?: string;
          display_name?: string;
          external_account_id?: string | null;
          id?: string;
          last_error?: string | null;
          owner_id?: string;
          status?: string;
          type?: string;
        };
      };
      contact_identities: {
        Row: {
          channel_type: string;
          contact_id: string | null;
          display_name: string | null;
          external_id: string;
          id: string;
          owner_id: string;
        };
        Insert: {
          channel_type: string;
          contact_id?: string | null;
          display_name?: string | null;
          external_id: string;
          id?: string;
          owner_id: string;
        };
        Update: {
          channel_type?: string;
          contact_id?: string | null;
          display_name?: string | null;
          external_id?: string;
          id?: string;
          owner_id?: string;
        };
      };
      contacts: {
        Row: {
          created_at: string;
          display_name: string;
          id: string;
          notes: string | null;
          owner_id: string;
        };
        Insert: {
          created_at?: string;
          display_name: string;
          id?: string;
          notes?: string | null;
          owner_id: string;
        };
        Update: {
          created_at?: string;
          display_name?: string;
          id?: string;
          notes?: string | null;
          owner_id?: string;
        };
      };
      conversations: {
        Row: {
          channel_id: string;
          external_thread_id: string;
          id: string;
          last_message_at: string | null;
          owner_id: string;
          subject: string | null;
        };
        Insert: {
          channel_id: string;
          external_thread_id: string;
          id?: string;
          last_message_at?: string | null;
          owner_id: string;
          subject?: string | null;
        };
        Update: {
          channel_id?: string;
          external_thread_id?: string;
          id?: string;
          last_message_at?: string | null;
          owner_id?: string;
          subject?: string | null;
        };
      };
      extractions: {
        Row: {
          calendar_event_id: string | null;
          confidence: number | null;
          confirmed_at: string | null;
          created_at: string;
          id: string;
          kind: string;
          message_id: string;
          model: string;
          owner_id: string;
          payload: Json;
        };
        Insert: {
          calendar_event_id?: string | null;
          confidence?: number | null;
          confirmed_at?: string | null;
          created_at?: string;
          id?: string;
          kind: string;
          message_id: string;
          model: string;
          owner_id: string;
          payload: Json;
        };
        Update: {
          calendar_event_id?: string | null;
          confidence?: number | null;
          confirmed_at?: string | null;
          created_at?: string;
          id?: string;
          kind?: string;
          message_id?: string;
          model?: string;
          owner_id?: string;
          payload?: Json;
        };
      };
      message_chunks: {
        Row: {
          chunk_index: number;
          content: string;
          embedding: string | null;
          id: string;
          message_id: string;
          owner_id: string;
        };
        Insert: {
          chunk_index: number;
          content: string;
          embedding?: string | null;
          id?: string;
          message_id: string;
          owner_id: string;
        };
        Update: {
          chunk_index?: number;
          content?: string;
          embedding?: string | null;
          id?: string;
          message_id?: string;
          owner_id?: string;
        };
      };
      messages: {
        Row: {
          body_html: string | null;
          body_text: string;
          channel_id: string;
          conversation_id: string | null;
          direction: string;
          external_id: string;
          id: string;
          ingested_at: string;
          owner_id: string;
          payload_raw: Json;
          sender_identity: string | null;
          sent_at: string;
          subject: string | null;
        };
        Insert: {
          body_html?: string | null;
          body_text: string;
          channel_id: string;
          conversation_id?: string | null;
          direction: string;
          external_id: string;
          id?: string;
          ingested_at?: string;
          owner_id: string;
          payload_raw: Json;
          sender_identity?: string | null;
          sent_at: string;
          subject?: string | null;
        };
        Update: {
          body_html?: string | null;
          body_text?: string;
          channel_id?: string;
          conversation_id?: string | null;
          direction?: string;
          external_id?: string;
          id?: string;
          ingested_at?: string;
          owner_id?: string;
          payload_raw?: Json;
          sender_identity?: string | null;
          sent_at?: string;
          subject?: string | null;
        };
      };
      raw_events: {
        Row: {
          attempts: number;
          channel_id: string;
          external_id: string | null;
          id: string;
          last_error: string | null;
          owner_id: string;
          payload: Json;
          received_at: string;
          status: string;
        };
        Insert: {
          attempts?: number;
          channel_id: string;
          external_id?: string | null;
          id?: string;
          last_error?: string | null;
          owner_id: string;
          payload: Json;
          received_at?: string;
          status?: string;
        };
        Update: {
          attempts?: number;
          channel_id?: string;
          external_id?: string | null;
          id?: string;
          last_error?: string | null;
          owner_id?: string;
          payload?: Json;
          received_at?: string;
          status?: string;
        };
      };
      sync_state: {
        Row: {
          channel_id: string;
          cursor: string | null;
          expires_at: string | null;
          owner_id: string;
          updated_at: string;
        };
        Insert: {
          channel_id: string;
          cursor?: string | null;
          expires_at?: string | null;
          owner_id: string;
          updated_at?: string;
        };
        Update: {
          channel_id?: string;
          cursor?: string | null;
          expires_at?: string | null;
          owner_id?: string;
          updated_at?: string;
        };
      };
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};

type DefaultSchema = Database['public'];

export type Tables<T extends keyof DefaultSchema['Tables']> =
  DefaultSchema['Tables'][T]['Row'];

export type TablesInsert<T extends keyof DefaultSchema['Tables']> =
  DefaultSchema['Tables'][T]['Insert'];

export type TablesUpdate<T extends keyof DefaultSchema['Tables']> =
  DefaultSchema['Tables'][T]['Update'];
