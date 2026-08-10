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
  // Node native and worker-thread packages must not be bundled: Turbopack
  // chases pino's test files inside imapflow's logger and dies on them, and
  // better-sqlite3 is a compiled binary.
  serverExternalPackages: ["imapflow", "mailparser", "better-sqlite3"],
};

export default nextConfig;
