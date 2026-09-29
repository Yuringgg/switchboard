import { BlobSASPermissions, BlobServiceClient } from '@azure/storage-blob';
import { NextResponse } from 'next/server';

import { opensInline } from '@/lib/files';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Long enough to open a file; short enough that a copied link is soon useless. */
const LINK_LIFETIME_MS = 5 * 60 * 1000;

/**
 * Open one saved file — Ms. Maria's research task 5.
 *
 * ⚠ **The row is read with the SIGNED-IN user's client**, so RLS decides
 * whether this file is theirs. Another tenant's id and a made-up one are the
 * same 404, the rule ADR-018 set for `/messages/[id]`. `/api` is in
 * `PUBLIC_PATHS` (for the webhooks), so the session is checked here as well.
 *
 * Then it redirects to a **five-minute, read-only** link for that one blob.
 * The container is private (`allowBlobPublicAccess: false`); nothing else can
 * read it. Redirecting rather than streaming the bytes through a Vercel
 * function keeps large files off the function's time and memory limits, and
 * keeps range requests (PDF paging) working.
 *
 * ⚠ Needs `AZURE_STORAGE_CONNECTION_STRING` on Vercel. Without it the answer
 * is a plain 503 saying so, never a broken link.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!UUID.test(id)) return new NextResponse('Not found', { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse('Sign in to open this file.', { status: 401 });

  const { data } = await supabase
    .from('attachments')
    .select('blob_url, filename, mime_type')
    .eq('id', id)
    .maybeSingle();
  if (!data) return new NextResponse('Not found', { status: 404 });

  const connection = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connection) {
    return new NextResponse(
      'File storage is not configured on this deployment (AZURE_STORAGE_CONNECTION_STRING).',
      { status: 503 },
    );
  }

  const file = data as { blob_url: string; filename: string | null; mime_type: string | null };
  const filename = file.filename || 'file';

  const blob = BlobServiceClient.fromConnectionString(connection)
    .getContainerClient(process.env.AZURE_STORAGE_CONTAINER || 'attachments')
    .getBlobClient(file.blob_url);

  const url = await blob.generateSasUrl({
    permissions: BlobSASPermissions.parse('r'),
    expiresOn: new Date(Date.now() + LINK_LIFETIME_MS),
    // A PDF or an image opens in the tab; anything else downloads, under the
    // name it was sent with (RFC 6266 `filename*`, so non-ASCII names survive).
    contentDisposition: `${opensInline(file.mime_type) ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(filename)}`,
    ...(file.mime_type ? { contentType: file.mime_type } : {}),
  });

  const response = NextResponse.redirect(url, 302);
  // The link is a five-minute bearer token. Nothing may cache it.
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
