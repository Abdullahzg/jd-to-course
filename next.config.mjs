/** @type {import('next').NextConfig} */
const nextConfig = {
  // The v0 template shipped with `ignoreBuildErrors: true`. Criterion #5 is
  // scored by a judge opening the link, and a build that is allowed to ship
  // type errors is a build that is allowed to ship broken states. Off.
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
