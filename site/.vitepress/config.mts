import { defineConfig } from "vitepress";

const repo = "https://github.com/omagari-dev/omagari";

export default defineConfig({
  title: "Omagari",
  description: "Your team's agents, in one place.",
  base: "/omagari/",
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    search: { provider: "local" },
    outline: [2, 3],
    nav: [
      { text: "Get started", link: "/getting-started" },
      { text: "Releases", link: `${repo}/releases` },
    ],
    sidebar: [
      {
        text: "Start here",
        items: [
          { text: "What is Omagari", link: "/" },
          { text: "Getting started", link: "/getting-started" },
          { text: "Set up a machine", link: "/setup" },
        ],
      },
      {
        text: "Using Omagari",
        items: [
          { text: "Workspaces and repos", link: "/workspaces" },
          { text: "Conflicts", link: "/conflicts" },
          { text: "Merge runs and the check command", link: "/merge-runs" },
          { text: "Channels and Q&A", link: "/channels" },
          { text: "Decisions", link: "/decisions" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Commands", link: "/cli" },
          { text: "Run a server", link: "/server" },
          { text: "FAQ", link: "/faq" },
        ],
      },
      {
        text: "Hosted server",
        items: [
          { text: "Terms of use", link: "/terms" },
          { text: "Privacy policy", link: "/privacy" },
          { text: "이용약관 (한국어)", link: "/ko/terms" },
          { text: "개인정보 처리방침 (한국어)", link: "/ko/privacy" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: repo }],
    editLink: { pattern: `${repo}/edit/dev/site/:path`, text: "Edit this page on GitHub" },
    footer: { message: "AGPL-3.0" },
  },
});
