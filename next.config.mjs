/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Keep pdfkit out of the webpack bundle so its .afm font-metric data
    // files are traced into the serverless function by @vercel/nft.
    serverComponentsExternalPackages: ['pdfkit'],
  },
};

export default nextConfig;
