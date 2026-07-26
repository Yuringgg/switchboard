import { NextResponse, type NextRequest } from 'next/server';

import { buildConfigReport } from '@/lib/config-report';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Which configuration actually reached this deployment?
 *
 * Vercel binds environment variables to a deployment when it is CREATED.
 * Adding a variable afterwards does nothing to deployments already built, and
 * the symptom is a 500 from one route while the rest of the app behaves
 * normally — which reads as a code bug and is not one.
 *
 * ⚠ Reports PRESENCE AND SHAPE ONLY. No value is returned, logged, or included
 * in an error.
 *
 * Signed-in users only: the set of variables a system expects is a map of its
 * integrations, which is not something to hand to anonymous callers.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return new NextResponse('Unauthorized', { status: 401 });

  return NextResponse.json(buildConfigReport(process.env, request.nextUrl.origin));
}
