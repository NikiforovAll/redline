import DefaultTheme from "vitepress/theme";
import { withBase, type Theme } from "vitepress";
import { h } from "vue";
import "./custom.css";

const heroVideo = () =>
  h("section", { class: "redline-hero-video" }, [
    h("video", {
      src: withBase("/hero.mp4"),
      poster: withBase("/hero-poster.jpg"),
      width: 1600,
      height: 900,
      autoplay: true,
      muted: true,
      loop: true,
      playsinline: true,
      "aria-label": "Claude posts a thread on the diff, you answer, Claude fixes the code and resolves the thread",
    }),
  ]);

const Layout = () => h(DefaultTheme.Layout, null, { "home-hero-after": heroVideo });

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
  Layout,
  enhanceApp() {
    if (typeof window !== "undefined") expandOnClick();
  },
};

export default theme;
