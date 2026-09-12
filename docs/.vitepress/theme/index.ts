import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import "./custom.css";

function expandOnClick() {
  document.addEventListener("click", (event) => {
    const img = (event.target as HTMLElement).closest<HTMLImageElement>(".VPHero .image-src, .vp-doc img");
    if (!img) return;
    const overlay = document.createElement("div");
    overlay.className = "redline-lightbox";
    const full = document.createElement("img");
    full.src = img.src;
    full.alt = img.alt;
    overlay.append(full);
    overlay.addEventListener("click", () => overlay.remove());
    document.body.append(overlay);
  });
}

const theme: Theme = {
  extends: DefaultTheme,
  enhanceApp() {
    if (typeof window !== "undefined") expandOnClick();
  },
};

export default theme;
