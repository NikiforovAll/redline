import { Composition, Sequence } from "remotion";
import { Hero, HERO_DURATION, HERO_FPS, HERO_POSTER_FRAME } from "./Hero";

const size = { width: 1600, height: 900, fps: HERO_FPS };

const HeroPoster = () => (
  <Sequence from={-HERO_POSTER_FRAME} layout="none">
    <Hero />
  </Sequence>
);

export const Root = () => (
  <>
    <Composition id="Hero" component={Hero} durationInFrames={HERO_DURATION} {...size} />
    <Composition id="HeroPoster" component={HeroPoster} durationInFrames={1} {...size} />
  </>
);
