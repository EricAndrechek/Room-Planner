# Brand assets

Sources (edit these):

- `logo.svg` master icon, `logo-small.svg` pixel-aligned variant used for the 16/32px favicon frames
- `logo-maskable.svg` (glyph inside the 80% safe zone), `logo-apple.svg` (opaque, slight padding)
- `og-template.svg` social card template; `og-image.svg` is generated from it (text baked to outlines from Inter, OFL)

Regenerate everything in `public/` (favicon.ico/svg, pwa-*.png, maskable, apple-touch-icon, og-image.png):

    pnpm add -D sharp svgo opentype.js @fontsource/inter   # once
    pnpm assets                                            # node brand/generate.mjs

Output is deterministic; commit the regenerated files.
