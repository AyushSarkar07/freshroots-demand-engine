import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The bundled SAP sample export is read at runtime to seed the first run.
  outputFileTracingIncludes: { "/**": ["./data/**/*.csv"] },
};

export default nextConfig;
