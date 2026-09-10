/**
 * The call-to-tenant link, shared by the two routes that use it.
 *
 * ⚠ Its own module rather than a constant exported from a route. Route modules
 * importing each other is how `/api/voice/call-session` — which has a session
 * and must never touch the service client — ends up loading it transitively
 * from `/api/webhooks/vapi`, which does. The boundary test greps for the import
 * string, so that would have passed the test and still been wrong.
 */

/**
 * How long a registered Vapi call stays valid.
 *
 * A call id is a bearer token by another name: anything that can present one to
 * the webhook is treated as that tenant for the length of the window. HMAC
 * signing is the real control, but an unbounded grant is still wrong, and calls
 * last minutes rather than hours.
 *
 * One hour, not ten minutes: a long call that outlives its own session would
 * start refusing tools halfway through, which sounds exactly like the assistant
 * breaking.
 */
export const CALL_SESSION_TTL_MS = 60 * 60 * 1000;

/**
 * Is this something we are willing to store as a primary key?
 *
 * ⚠ The id is opaque — its format belongs to Vapi and is not ours to assume.
 * But "opaque" is not "anything": a length cap and a conservative character
 * class keep a hostile value out of a key column without depending on a shape
 * they never promised to keep.
 */
export function isPlausibleCallId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 128 &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}
