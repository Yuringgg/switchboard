import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Type errors and lint failures must break the build, never be waved through.
  // This is the default; it is stated explicitly so nobody "fixes" a red build
  // by turning it off.
  typescript: { ignoreBuildErrors: false },

  // `@switchboard/core` is shipped as TypeScript source, not built output, so
  // Next has to compile it like first-party code.
  transpilePackages: ['@switchboard/core'],
};

export default nextConfig;
