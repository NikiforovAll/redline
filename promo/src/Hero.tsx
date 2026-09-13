import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

export const HERO_FPS = 30;

const UI = "Inter, 'Segoe UI', system-ui, sans-serif";
const MONO = "'JetBrains Mono', 'Cascadia Mono', Consolas, monospace";

const C = {
  bg: "#ffffff",
  soft: "#f6f6f7",
  divider: "#e2e2e3",
  text1: "#3c3c43",
  text2: "#67676c",
  text3: "#929295",
  brand: "#e5484d",
  brandDark: "#b32b30",
  brandSoft: "rgba(229, 72, 77, 0.14)",
  green: "#18794e",
  greenSoft: "rgba(24, 121, 78, 0.12)",
  keyword: "#8250df",
  fn: "#0550ae",
  type: "#953800",
};

const T = {
  card: 65,
  claude: 105,
  type: 160,
  post: 235,
  fix: 260,
  end: 315,
};

export const HERO_DURATION = T.end + 105;
export const HERO_POSTER_FRAME = T.fix + 30;

const clamp = (f: number, a: number, b: number, from = 0, to = 1, easing?: (n: number) => number) =>
  interpolate(f, [a, b], [from, to], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing });

const ease = Easing.out(Easing.cubic);

type Tok = [string, "text" | "keyword" | "fn" | "type"];
type Row = { kind: "ctx" | "add" | "del"; toks: Tok[]; fixed?: Tok[] };

const ROWS: Row[] = [
  { kind: "ctx", toks: [["export", "keyword"], [" ", "text"], ["async", "keyword"], [" ", "text"], ["function", "keyword"], [" ", "text"], ["refresh", "fn"], ["(session: ", "text"], ["Session", "type"], [") {", "text"]] },
  { kind: "del", toks: [["  ", "text"], ["const", "keyword"], [" token = session.token;", "text"]] },
  {
    kind: "add",
    toks: [["  ", "text"], ["const", "keyword"], [" token = ", "text"], ["await", "keyword"], [" store.", "text"], ["get", "fn"], ["(session.id);", "text"]],
    fixed: [["  ", "text"], ["const", "keyword"], [" token = ", "text"], ["await", "keyword"], [" store.", "text"], ["get", "fn"], ["(session.id) ?? ", "text"], ["expired", "fn"], ["(session);", "text"]],
  },
  { kind: "add", toks: [["  ", "text"], ["return", "keyword"], [" client.", "text"], ["refresh", "fn"], ["(token.value);", "text"]] },
  { kind: "ctx", toks: [["}", "text"]] },
];

const Code = ({ toks }: { toks: Tok[] }) => (
  <span style={{ whiteSpace: "pre" }}>
    {toks.map(([s, k], i) => <span key={i} style={{ color: k === "text" ? C.text1 : C[k] }}>{s}</span>)}
  </span>
);

const Asterisk = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={C.brand} strokeWidth={2.6} strokeLinecap="round">
    <path d="M12 3v18 M3 12h18 M5.6 5.6l12.8 12.8 M18.4 5.6 5.6 18.4" />
  </svg>
);

const Lockup = ({ logo, text }: { logo: number; text: number }) => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: logo * 0.3 }}>
    <Img src={staticFile("logo.svg")} style={{ width: logo, height: logo, borderRadius: logo * 0.23 }} />
    <span style={{ fontFamily: UI, fontWeight: 700, fontSize: text, letterSpacing: -text * 0.03, lineHeight: 1, background: `linear-gradient(120deg, ${C.brandDark} 30%, ${C.brand})`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>Redline</span>
  </div>
);

const Avatar = ({ who }: { who: "claude" | "you" }) => (
  <div style={{ width: 28, height: 28, borderRadius: 14, display: "grid", placeItems: "center", background: who === "claude" ? C.brandSoft : "#e3e8ef", color: C.text1, fontWeight: 700, fontSize: 13 }}>
    {who === "claude" ? <Asterisk size={16} /> : "Y"}
  </div>
);

const Intro = ({ frame, fps }: { frame: number; fps: number }) => {
  const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 26 });
  const sub = clamp(frame, 14, 34, 0, 1, ease);
  const leave = clamp(frame, T.card - 10, T.card + 8, 0, 1, Easing.inOut(Easing.cubic));
  return (
    <AbsoluteFill style={{ background: C.bg, opacity: 1 - leave, alignItems: "center", justifyContent: "center", fontFamily: UI }}>
      <div style={{ opacity: enter, transform: `translateY(${(1 - enter) * 18 - leave * 14}px)`, textAlign: "center" }}>
        <Lockup logo={104} text={116} />
        <div style={{ marginTop: 26, fontSize: 34, fontWeight: 600, color: C.text1, letterSpacing: -0.5, opacity: sub, transform: `translateY(${(1 - sub) * 10}px)` }}>
          Code review for Claude Code and VS Code
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Steps = ({ frame }: { frame: number }) => {
  const steps: [string, number][] = [
    ["Claude reviews the diff", T.claude],
    ["You answer in the thread", T.type],
    ["Claude fixes and replies", T.fix],
  ];
  return (
    <div style={{ position: "absolute", left: 110, top: 190, width: 330, fontFamily: UI }}>
      <div style={{ display: "flex", marginBottom: 46 }}>
        <Lockup logo={40} text={40} />
      </div>
      {steps.map(([label, at], i) => {
        const on = clamp(frame, at, at + 12, 0, 1, ease);
        const started = frame >= at;
        const done = i < 2 && frame >= steps[i + 1][1] + 6;
        const badge = done ? [C.greenSoft, C.green] : started ? [C.brandSoft, C.brandDark] : [C.soft, C.text3];
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 16, height: 62 }}>
            <div style={{ width: 34, height: 34, borderRadius: 17, display: "grid", placeItems: "center", fontSize: 15, fontWeight: 600, background: badge[0], color: badge[1] }}>
              {done ? "✓" : i + 1}
            </div>
            <span style={{ fontSize: 21, fontWeight: 500, color: started ? C.text1 : C.text3, opacity: 0.55 + on * 0.45 }}>{label}</span>
          </div>
        );
      })}
    </div>
  );
};

const Author = ({ who, frame, at }: { who: "claude" | "you"; frame: number; at: number }) => {
  const o = clamp(frame, at, at + 10, 0, 1, ease);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, opacity: o, transform: `translateY(${(1 - o) * 6}px)` }}>
      <Avatar who={who} />
      <span style={{ fontWeight: 600, fontSize: 17, color: C.text1 }}>{who === "claude" ? "Claude" : "You"}</span>
    </div>
  );
};

const Card = ({ frame, fps }: { frame: number; fps: number }) => {
  const enter = spring({ frame: frame - T.card, fps, config: { damping: 200 }, durationInFrames: 28 });
  const fixed = frame >= T.fix;
  const swap = clamp(frame, T.fix, T.fix + 8);
  const threadOpen = clamp(frame, T.claude, T.claude + 14, 0, 1, ease);
  const typed = "Fail fast here and add a test for the expired session.";
  const chars = Math.min(typed.length, Math.max(0, Math.floor(((frame - T.type) / fps) * 20)));
  const posted = frame >= T.post;
  const caret = frame >= T.type && !posted && Math.floor(frame / 9) % 2 === 0;
  const code = { fontFamily: MONO, fontSize: 15, background: C.soft, padding: "1px 6px", borderRadius: 4 };

  const row = (r: Row, i: number) => {
    const flagged = i === 2;
    const bg = r.kind === "add" ? "rgba(24,121,78,.08)" : r.kind === "del" ? "rgba(229,72,77,.08)" : "transparent";
    const highlight = flagged ? clamp(frame, T.claude, T.claude + 10, 0, 1) * (1 - clamp(frame, T.fix, T.fix + 10)) : 0;
    return (
      <div key={i} style={{ position: "relative", display: "flex", alignItems: "center", height: 38, background: bg, fontFamily: MONO, fontSize: 17 }}>
        <div style={{ position: "absolute", inset: 0, background: C.brandSoft, boxShadow: `inset 3px 0 0 ${C.brand}`, opacity: highlight }} />
        <span style={{ width: 56, textAlign: "right", color: C.text3, fontSize: 14, paddingRight: 14 }}>{12 + i}</span>
        <span style={{ width: 22, color: r.kind === "add" ? C.green : r.kind === "del" ? C.brand : "transparent" }}>{r.kind === "add" ? "+" : "−"}</span>
        <span style={{ position: "relative" }}>
          <span style={{ opacity: r.fixed ? 1 - swap : 1 }}><Code toks={r.toks} /></span>
          {r.fixed && <span style={{ position: "absolute", left: 0, top: 0, opacity: swap }}><Code toks={r.fixed} /></span>}
        </span>
      </div>
    );
  };

  return (
    <div style={{ position: "absolute", left: 500, top: 170, width: 990, opacity: enter, transform: `translateY(${(1 - enter) * 24}px)`, fontFamily: UI }}>
      <div style={{ background: C.bg, border: `1px solid ${C.divider}`, borderRadius: 12, boxShadow: "0 12px 40px rgba(0,0,0,.10)", overflow: "hidden" }}>
        <div style={{ height: 44, display: "flex", alignItems: "center", gap: 10, padding: "0 20px", background: C.soft, borderBottom: `1px solid ${C.divider}`, fontSize: 15, color: C.text2 }}>
          <span style={{ fontWeight: 600, color: C.text1 }}>session.ts</span>
          <span>packages/server/src/auth</span>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 13, background: C.brandSoft, color: C.brandDark, borderRadius: 10, padding: "3px 10px", fontWeight: 600 }}>Round 6 · 7 notes</span>
        </div>
        <div style={{ padding: "12px 0" }}>{ROWS.slice(0, 3).map(row)}</div>

        <div style={{ maxHeight: 420 * threadOpen, opacity: threadOpen, overflow: "hidden", margin: "0 20px", borderTop: `1px solid ${C.divider}`, borderBottom: `1px solid ${C.divider}` }}>
          <div style={{ padding: "18px 4px 6px", display: "flex", flexDirection: "column", gap: 18 }}>
            <div>
              <Author who="claude" frame={frame} at={T.claude + 4} />
              <div style={{ marginLeft: 38, marginTop: 8, fontSize: 18, lineHeight: 1.5, color: C.text1, opacity: clamp(frame, T.claude + 8, T.claude + 18) }}>
                <span style={{ fontWeight: 600, color: C.text2 }}>3/7</span>&nbsp; <code style={code}>store.get</code> returns <code style={code}>undefined</code> when the session expired. Line 15 then throws on <code style={code}>token.value</code>.
              </div>
            </div>

            {posted ? (
              <div>
                <Author who="you" frame={frame} at={T.post} />
                <div style={{ marginLeft: 38, marginTop: 8, fontSize: 18, lineHeight: 1.5, color: C.text1 }}>{typed}</div>
              </div>
            ) : (
              <div style={{ opacity: clamp(frame, T.claude + 14, T.claude + 24) }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Avatar who="you" />
                  <div style={{ flex: 1, height: 42, border: `1px solid ${frame >= T.type ? C.brand : C.divider}`, borderRadius: 8, display: "flex", alignItems: "center", padding: "0 14px", fontSize: 17, color: chars ? C.text1 : C.text3, background: C.bg }}>
                    {chars ? typed.slice(0, chars) : "Reply to Claude"}
                    {caret && <span style={{ marginLeft: 1, width: 2, height: 22, background: C.text1, display: "inline-block" }} />}
                  </div>
                </div>
              </div>
            )}

            {fixed && (
              <div>
                <Author who="claude" frame={frame} at={T.fix} />
                <div style={{ marginLeft: 38, marginTop: 8, fontSize: 18, lineHeight: 1.5, color: C.text1, opacity: clamp(frame, T.fix + 4, T.fix + 14) }}>
                  Done. <code style={code}>expired()</code> throws on a missing token, and <code style={code}>session.test.ts</code> covers it.
                </div>
                <div style={{ marginLeft: 38, marginTop: 12, display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600, color: C.green, background: C.greenSoft, borderRadius: 10, padding: "4px 12px", opacity: clamp(frame, T.fix + 10, T.fix + 20) }}>
                  ✓ Resolved
                </div>
              </div>
            )}
            <div style={{ height: 10 }} />
          </div>
        </div>

        <div style={{ padding: "12px 0" }}>{ROWS.slice(3).map((r, i) => row(r, i + 3))}</div>
      </div>
    </div>
  );
};

const EndCard = ({ frame }: { frame: number }) => {
  const o = clamp(frame, T.end, T.end + 18, 0, 1, ease);
  return (
    <AbsoluteFill style={{ background: C.bg, opacity: o, alignItems: "center", justifyContent: "center", fontFamily: UI }}>
      <div style={{ textAlign: "center", transform: `translateY(${(1 - o) * 12}px)` }}>
        <Lockup logo={80} text={88} />
        <div style={{ marginTop: 26, fontSize: 28, color: C.text1, fontWeight: 500 }}>Claude posts threads on the diff. You answer. Claude works through every one.</div>
        <div style={{ marginTop: 34, display: "inline-flex", alignItems: "center", gap: 12 }}>
          <span style={{ background: C.brand, color: "#fff", borderRadius: 20, padding: "10px 22px", fontSize: 16, fontWeight: 600 }}>Get started</span>
          <span style={{ background: C.soft, color: C.text1, borderRadius: 20, padding: "10px 22px", fontSize: 16, fontWeight: 600, fontFamily: MONO }}>code --install-extension nikiforovall.redline-extension</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const Hero = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      {frame >= T.card - 10 && frame < T.end + 18 && (
        <>
          <Steps frame={frame} />
          <Card frame={frame} fps={fps} />
        </>
      )}
      {frame < T.card + 10 && <Intro frame={frame} fps={fps} />}
      {frame >= T.end && <EndCard frame={frame} />}
    </AbsoluteFill>
  );
};
