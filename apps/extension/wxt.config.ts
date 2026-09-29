import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "wxt"

export default defineConfig({
  modules: ["@wxt-dev/module-react", "@wxt-dev/i18n/module"],
  // WXT and Tailwind resolve distinct Vite types; this boundary is valid at runtime.
  // biome-ignore lint/suspicious/noExplicitAny: upstream Vite type duplication
  vite: (): any => ({ plugins: tailwindcss() }),
  manifest: {
    name: "Visual Scraper",
    description: "Teach a local browser scraper by selecting example fields.",
    default_locale: "en",
    permissions: ["storage", "activeTab", "scripting", "tabs"],
    optional_host_permissions: ["http://*/*", "https://*/*"],
    browser_specific_settings: {
      gecko: {
        id: "visual-scraper@local.example",
        data_collection_permissions: { required: ["none"] },
      },
    },
    web_accessible_resources: [
      { resources: ["content-scripts/content.css"], matches: ["<all_urls>"] },
    ],
    action: {
      default_icon: {
        "16": "icon/16.png",
        "32": "icon/32.png",
        "48": "icon/48.png",
        "128": "icon/128.png",
      },
    },
  },
})
