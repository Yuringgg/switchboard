// Worker side: Drizzle tables + inferred types (service_role, bypasses RLS).
export * from './schema';
export { createDbClient, type Database } from './client';

// Console side: generated types for supabase-js (publishable key, RLS applies).
export type {
  Database as SupabaseDatabase,
  Json,
  Tables,
  TablesInsert,
  TablesUpdate,
} from './supabase-types';
