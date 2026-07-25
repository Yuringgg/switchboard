import { NextResponse, type NextRequest } from 'next/server';

/**
 * Supabase keepalive.
 *
 * Free-tier projects are paused after **7 days with no activity**, and a paused
 * project is simply offline — which is how a demo dies on the morning it
 * matters. Five minutes now, per docs/02-ARCHITECTURE.md §5.
 *
 * Deliberately an OUTBOUND request from Vercel to Supabase rather than a
 * pg_cron job inside the database: what counts as "activity" is Supabase's
 * call, and a real API request from outside is unambiguous where an internal
 * timer is not.
 *
 * Scheduled daily by `vercel.json`. Hobby allows one cron run per day, which is
 * exactly the cadence needed against a 7-day timer.
 */

export const runtime = 'nodejs';
// Never served from cache — a cached 200 would mean no query reached Supabase,
// and the project would pause while this endpoint cheerfully reported success.
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // Vercel sends `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set.
  // Without the check this is an unauthenticated endpoint anyone can hammer.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return new NextResponse('Unauthorized', { status: 401 });
    }
  } else if (process.env.NODE_ENV === 'production') {
    // Fail loudly rather than run an open endpoint in production.
    console.error('[cron/keepalive] CRON_SECRET is not set; refusing to run');
    return new NextResponse('Not configured', { status: 503 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    return new NextResponse('Not configured', { status: 503 });
  }

  try {
    // A HEAD against a real table with an exact count. RLS applies and there is
    // no session, so this reads zero rows and returns no data — but it is a
    // genuine authenticated query that reaches Postgres, which is the point.
    const response = await fetch(`${url}/rest/v1/messages?select=id&limit=1`, {
      method: 'HEAD',
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        prefer: 'count=exact',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      console.error('[cron/keepalive] Supabase responded', response.status);
      return NextResponse.json(
        { ok: false, status: response.status },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true, at: new Date().toISOString() });
  } catch (error) {
    console.error('[cron/keepalive] request failed', error);
    return NextResponse.json({ ok: false }, { status: 502 });
  }
}
