import { ImageResponse } from 'next/og';

/**
 * The browser-tab mark.
 *
 * Generated rather than checked in as an .ico so it stays a single source of
 * truth with `components/brand.tsx` — the same patched line and lit jack,
 * redrawn at 32px where the thin stroke of the full mark would disappear. A
 * favicon that has drifted from the logo is the kind of thing nobody files a
 * bug about and everybody notices.
 *
 * ⚠ Colours are literals, not tokens. This renders on the server into a PNG,
 * where no CSS custom property exists — and a tab icon has no way to follow
 * the OS theme anyway, so it is drawn to read on both: a light mark on a dark
 * plate works against either browser chrome.
 */
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          background: '#17181c',
          borderRadius: 7,
        }}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#fafafa"
          strokeWidth={2.25}
          strokeLinecap="round"
        >
          <path d="M3 5h6a4 4 0 0 1 4 4v6a4 4 0 0 0 4 4h4" />
          <circle cx="20.5" cy="5" r="2" fill="#fbbf3c" stroke="none" />
        </svg>
      </div>
    ),
    size,
  );
}
