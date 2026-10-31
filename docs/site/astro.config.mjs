import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://rabbitfiremediacreation.github.io",
  base: "/music-generator-desktop",
  output: "static",
  trailingSlash: "always",
  integrations: [
    starlight({
      title: "Music Generator",
      logo: { src: "./public/favicon.svg" },
      customCss: ["./src/styles/docs.css"],
      components: { PageFrame: "./src/components/PageFrame.astro" },
      defaultLocale: "de",
      locales: {
        de: { label: "Deutsch", lang: "de" },
        en: { label: "English", lang: "en" },
      },
      sidebar: [
        { slug: "" },
        {
          label: "Guides",
          translations: { de: "Anleitungen" },
          items: [{ autogenerate: { directory: "guides" } }],
        },
      ],
      editLink: {
        baseUrl: "https://github.com/rabbitfiremediacreation/music-generator-desktop/edit/main/docs/site/",
      },
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/rabbitfiremediacreation/music-generator-desktop",
        },
      ],
    }),
  ],
});
