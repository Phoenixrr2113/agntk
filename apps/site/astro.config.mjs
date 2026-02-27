import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import vercel from '@astrojs/vercel';

export default defineConfig({
  adapter: vercel({
    maxDuration: 300,
  }),
  // Bundle Upstash deps into the serverless function
  // (pnpm symlinks break in Vercel's deployed node_modules)
  vite: {
    ssr: {
      noExternal: ['@upstash/redis', '@upstash/ratelimit'],
    },
  },
  integrations: [
    starlight({
      title: 'agntk',
      description: 'Zero-config AI agent CLI with real tools, durable workflows, and HTTP interfaces',
      logo: {
        light: './src/assets/logo-light.svg',
        dark: './src/assets/logo-dark.svg',
        replacesTitle: false,
      },
      customCss: [
        '@fontsource-variable/inter',
        '@fontsource/jetbrains-mono/400.css',
        '@fontsource/jetbrains-mono/500.css',
        '@fontsource/jetbrains-mono/600.css',
        './src/styles/custom.css',
      ],
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/Phoenixrr2113/agntk' },
      ],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Introduction', link: '/getting-started/introduction' },
            { label: 'Installation', link: '/getting-started/installation' },
            { label: 'Quick Start', link: '/getting-started/quick-start' },
            { label: 'What It Does', link: '/getting-started/what-it-does' },
            { label: 'Zero-Config Providers', link: '/getting-started/providers' },
            { label: 'Named Agents & Memory', link: '/getting-started/named-agents' },
            { label: 'Local Inference', link: '/getting-started/local-inference' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'CLI Reference', link: '/packages/cli' },
            { label: 'SDK & Packages', link: '/packages/sdk' },
            { label: 'Configuration', link: '/configuration/yaml-config' },
          ],
        },
      ],
    }),
  ],
});
