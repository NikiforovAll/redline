import { defineConfig } from "vitepress";

const site = "https://nikiforovall.blog/redline/";
const title = "Redline";
const description = "Two-way code review between you and Claude Code, inside VS Code. Claude posts its review as threads on the diff. You answer and add your own. Claude works through every thread in place.";

export default defineConfig({
  title,
  description,
  base: "/redline/",
  cleanUrls: true,
  ignoreDeadLinks: true,
  srcExclude: ["PUBLISHING.md", "DEVELOPMENT.md"],
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/redline/logo.svg" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:title", content: `${title}: code review for Claude Code and VS Code` }],
    ["meta", { property: "og:description", content: description }],
    ["meta", { property: "og:url", content: site }],
    ["meta", { property: "og:image", content: `${site}og.png` }],
    ["meta", { property: "og:image:width", content: "1200" }],
    ["meta", { property: "og:image:height", content: "630" }],
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
    ["meta", { name: "twitter:title", content: `${title}: code review for Claude Code and VS Code` }],
    ["meta", { name: "twitter:description", content: description }],
    ["meta", { name: "twitter:image", content: `${site}og.png` }],
  ],
  themeConfig: {
    logo: "/logo.svg",
    nav: [
      { text: "Home", link: "/" },
      { text: "Guide", link: "/guide" },
      { text: "Reference", link: "/reference" },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Overview", link: "/" },
          { text: "Install", link: "/guide#install" },
          { text: "Review mode", link: "/guide#review-mode" },
          { text: "Tour mode", link: "/guide#tour-mode" },
          { text: "Threads and submit", link: "/guide#the-round-view" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Skills", link: "/reference#skills" },
          { text: "Commands and shortcuts", link: "/reference#commands-and-shortcuts" },
          { text: "Settings", link: "/reference#settings" },
          { text: "MCP tools", link: "/reference#mcp-tools" },
          { text: "Error text", link: "/reference#error-text" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/nikiforovall/redline" }],
    editLink: {
      pattern: "https://github.com/nikiforovall/redline/edit/main/docs/:path",
    },
    search: { provider: "local" },
  },
});
