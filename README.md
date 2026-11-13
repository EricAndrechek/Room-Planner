<div align="center">

<img src="public/favicon.svg" width="150" height="150" alt="Room Planner Logo">

# Room Planner

**Design and visualize your perfect room layout**

A powerful, intuitive tool for planning room layouts with furniture, doors, and windows. Drag, drop, and arrange items to create your ideal space.

**[🚀 Try Room Planner Now →](https://roomplanner.andrechek.com/)**

</div>

---

## ✨ Features

### 📐 Room Configuration

- **Flexible Dimensions** - Set room size in multiple unit systems (feet & inches, decimal feet, inches, meters, centimeters)
- **Smart Input Parsing** - Type dimensions naturally (e.g., `12'6"`, `150in`, `3.5m`, `350cm`)
- **Multiple Doors & Windows** - Add unlimited doors and windows with customizable positions
- **Door Types** - Swing-in, swing-out, and sliding door options

### 🪑 Furniture Management

- **Drag & Drop** - Intuitive positioning with touch and mouse support
- **Rotation** - Rotate items using the handle, with 45° snap for precision
- **Custom Sizing** - Set exact width and depth for each piece
- **Color Coding** - 10 preset colors plus custom hex color picker
- **Visibility Toggle** - Hide/show items to compare layouts
- **Item Locking** - Lock furniture to prevent accidental moves

### 💾 Save & Share

- **Project Management** - Save multiple floor plans with auto-save
- **Share Links** - Generate URLs that preserve your exact layout
- **JSON Export/Import** - Full backup and restore capability
- **Inline Renaming** - Click project name to rename (like Google Docs)

### 📴 Offline & Install

- **Works Offline** - After the first visit the whole app is cached by a service worker
- **Installable** - Add Room Planner to your home screen or desktop as a standalone app
- **Update Prompts** - A small notice appears when a new version is ready

### 🔒 Privacy

- **Your Plans Stay Local** - Floor plans live in your browser; share links keep the layout in the URL fragment, which never reaches a server
- **Anonymous Analytics** - Optional, cookieless usage and error stats with no plan content; opt out any time on the Help page

### 🎯 Smart Feedback

- **Collision Detection** - Visual warnings when furniture overlaps
- **Boundary Alerts** - Indicators when items extend outside room
- **Real-time Preview** - See changes instantly as you design

### 📱 Responsive Design

- **Desktop** - Side-by-side panel layout with zoom controls
- **Mobile** - Full-screen modes with contextual navigation
- **Touch Optimized** - Designed for both mouse and touch interaction

---

## How to Use

### Two-Step Design Process

Room Planner uses a focused two-step workflow:

#### Step 1: Room Setup (Purple)

Configure the room shell before adding furniture:

1. **Set Dimensions** - Enter room width and height
2. **Add Doors** - Click "+ Add Door", set position, width, wall, and type
3. **Add Windows** - Click "+ Add Window", configure position and width
4. **Drag to Position** - On the canvas, drag door/window handles to fine-tune placement

#### Step 2: Furniture (Green)

Add and arrange your furniture:

1. **Add Items** - Click "+ Add Furniture" and customize name, size, and color
2. **Drag to Move** - Click and drag any furniture piece to reposition
3. **Rotate** - Use the circular handle on each item to rotate (snaps to 45°)
4. **Edit Details** - Click an item in the sidebar to adjust dimensions and color
5. **Lock Items** - Click the lock icon to prevent accidental changes

### Unit Systems

Switch between measurement systems anytime:

| System        | Example   | Use Case         |
| ------------- | --------- | ---------------- |
| Feet & Inches | `12'6"`   | US residential   |
| Decimal Feet  | `12.5 ft` | US commercial    |
| Inches        | `150 in`  | Detailed work    |
| Meters        | `3.8 m`   | International    |
| Centimeters   | `380 cm`  | Precision metric |

**Tip:** You can type values with any unit suffix and they'll convert automatically!

### Saving & Sharing

- **Auto-Save** - Your work saves automatically to your browser
- **My Floor Plans** - Click the folder icon to manage multiple projects
- **Share Link** - Click "Share / Save" to get a URL with your complete layout
- **Export JSON** - Download a backup file you can import later

### Keyboard Shortcuts

| Shortcut               | Action                       |
| ---------------------- | ---------------------------- |
| `Ctrl/⌘ + Z`           | Undo                         |
| `Ctrl/⌘ + Shift + Z`   | Redo                         |
| `Delete` / `Backspace` | Delete selected item         |
| `Escape`               | Deselect item                |
| `Arrow Keys`           | Move selected item (0.25 ft) |
| `Shift + Arrow Keys`   | Move selected item (1 ft)    |
| `R`                    | Rotate selected item 90°     |

### Visual Indicators

| Indicator            | Meaning                                                 |
| -------------------- | ------------------------------------------------------- |
| 🔴 Red border + ⚠️   | Furniture overlaps another item or extends outside room |
| 🟡 Amber border + 🔒 | Item is locked (cannot be moved or resized)             |
| 👁️ Dashed border     | Item is hidden (won't appear in final layout)           |

---

## 🚀 For Developers

### Prerequisites

- **Node.js** 22.23.4 or higher (see `.nvmrc`)
- **pnpm** (the version is pinned in `package.json` → `packageManager`; `corepack enable` picks it up)

### Getting Started

```bash
git clone https://github.com/EricAndrechek/Room-Planner.git
cd Room-Planner
pnpm install
pnpm dev
```

Open [http://localhost:4321](http://localhost:4321) in your browser.

### Scripts

| Command            | What it does                                                                                         |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| `pnpm dev`         | Astro dev server                                                                                     |
| `pnpm build`       | Static build into `dist/` (also generates the service worker and manifest)                           |
| `pnpm preview`     | Serve `dist/` locally                                                                                |
| `pnpm check`       | Type-check (`astro check` plus the Worker, TypeScript strict)                                        |
| `pnpm lint`        | ESLint (typescript-eslint + react-hooks)                                                             |
| `pnpm format`      | Prettier (with `prettier-plugin-astro`)                                                              |
| `pnpm test`        | Vitest unit tests plus the Worker proxy tests                                                        |
| `pnpm test:e2e`    | Playwright specs (Chromium) against a fresh build on port 43291                                      |
| `pnpm assets`      | Regenerate icons and social images from `brand/`                                                     |
| `pnpm screenshots` | Regenerate the PWA manifest screenshots (needs a running preview server)                             |
| `pnpm dev:worker`  | Build, then run the Cloudflare Worker locally with `wrangler dev`                                    |
| `pnpm deploy`      | `wrangler deploy` (normally done by Cloudflare Workers Builds; see [docs/DEPLOY.md](docs/DEPLOY.md)) |

To run the e2e suite against an already-running server (for example `wrangler dev`
on port 8787, which also exercises the CSP headers), set `E2E_BASE_URL`:
`E2E_BASE_URL=http://localhost:8787 pnpm test:e2e`.

The public site URL used for canonical links, Open Graph tags, the sitemap and
`robots.txt` comes from `SITE_URL` at build time (default
`https://roomplanner.andrechek.com`), e.g. `SITE_URL=https://example.com pnpm build`.

### Analytics

Anonymous, cookieless analytics and error tracking come from PostHog's web snippet
(`src/components/PostHog.astro`), sent through the same-origin `/rpq` reverse proxy
(`worker/proxy.ts`). There is no build-time configuration: the project token is a public
client token, and the `environment` property (`production` / `preview` / `development`) is
derived from the hostname at runtime. Analytics is off under automation (`navigator.webdriver`)
and on `localhost`. To debug it, run `localStorage['rp:analytics-debug']='1'` in the browser
console and reload (works on localhost too; enables `debug` logging). In `pnpm dev`, `/rpq` is
proxied to PostHog; with `wrangler dev` the Worker does it.

Deployment and the domain cutover are documented in [docs/DEPLOY.md](docs/DEPLOY.md).

### Project Structure

```
src/
├── pages/                 # index (planner island), help, 404, robots.txt
├── layouts/Base.astro     # <head>: SEO, Open Graph, icons, JSON-LD
├── components/
│   ├── PlannerApp.tsx     # client-only island root: boot + ErrorBoundary
│   ├── ErrorBoundary.tsx
│   └── planner/           # Planner (state orchestration), Header, Sidebar,
│                          # RoomSetupPanel, FurniturePanel/Card, RoomCanvas,
│                          # FurniturePiece, Openings, modals, ColorPicker...
├── hooks/                 # useHistory, useProjects (autosave), usePanZoom,
│                          # usePointerDrag, useRotationDrag, useKeyboardShortcuts...
├── lib/                   # pure, unit-tested logic: units, geometry, layout,
│                          # share, storage, projects, boot, analytics facade
├── styles/global.css      # Tailwind v4 + app styles
└── types.ts
e2e/                       # Playwright specs
```

### Architecture Notes

- All measurements are stored internally in **feet**, converted for display based on the unit system
- Colors are stored as **hex values** for consistent sharing across browsers
- Persistence is `localStorage` in the same keys/format the app has always used
  (`room-planner-projects`, `room-sim-v3-*`), plus a `room-planner-schema` version
  marker; `src/lib/storage.ts` documents the format and its migrations
- Share links put a deflate-compressed, base64url payload in the URL **fragment**
  (`#s=…`), so layouts never reach a server; old `?config=` links still open
- `src/lib/analytics.ts` is a typed facade over the PostHog web snippet's `window.posthog` (calls queue until the SDK loads; harmless no-ops when analytics is off)
- `src/lib/pwa.ts` / `pwa-options.mjs` configure the service worker via `@vite-pwa/astro`

---

## 🚢 Deployment

The site is deployed as a Cloudflare Worker serving the static `dist/`. Cloudflare Workers
Builds builds and deploys `main` on every push and builds a preview for each PR branch (see
[docs/DEPLOY.md](docs/DEPLOY.md)). `pnpm build` itself produces a fully static site in
`dist/` that any static host can serve. If the site is served from a sub-path, set Astro's `base` in
`astro.config.mjs`; all internal links are base-aware.

---

## 🤝 Contributing

Contributions are welcome! Here's how to get started:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

### Ideas for Contributions / TODOs

- [ ] Export to image/PDF
- [ ] Measurement tool (click to measure distances)
- [ ] 3D view / isometric preview
- [ ] Multi-room floor plans
- [ ] Non-rectangular room shapes
- [ ] Furniture snapping/alignment guides
- [ ] Collaborative editing (real-time multi-user) (while keeping no backend?)
- [ ] Accessibility improvements (ARIA, keyboard nav)
- [ ] Export to CAD formats (DXF, SVG)
- [ ] Reusable furniture library
- [x] Reloading the page with a shared link causes a duplicate floor plan to be added with the same name
- [x] Refactor `App.jsx` into smaller components for maintainability

---

## 🛠️ Technology Stack

| Technology                                                          | Purpose                     |
| ------------------------------------------------------------------- | --------------------------- |
| [Astro](https://astro.build)                                        | Static pages + React island |
| [React 19](https://react.dev)                                       | UI framework with hooks     |
| [TypeScript](https://www.typescriptlang.org)                        | Strict typing               |
| [Tailwind CSS 4](https://tailwindcss.com)                           | Utility-first styling       |
| [Vitest](https://vitest.dev) / [Playwright](https://playwright.dev) | Unit / end-to-end tests     |
| [Lucide React](https://lucide.dev)                                  | Beautiful icon library      |
| LocalStorage                                                        | Client-side persistence     |

---

## 🤖 AI Disclosure

This project was developed with assistance from **GitHub Copilot** (powered by Claude). AI was used for:

- **Code generation** - Writing React components, event handlers, and styling
- **Feature implementation** - Drag-and-drop logic, collision detection, unit conversion
- **Bug fixes and refactoring** - Improving code quality and fixing edge cases
- **Documentation** - Generating this README and code comments

All AI-generated code was reviewed, tested, and refined by a human developer. The project direction, feature decisions, and final implementation choices were made by the human author.

---

## 🙏 Acknowledgments

- **[Knobs](https://jherrm.github.io/knobs/)** by [@jherrm](https://github.com/jherrm/knobs) - Original rotation knob inspiration
- Icons by [Lucide](https://lucide.dev)
- Built with [Astro](https://astro.build) + [React](https://react.dev)
- Styled with [Tailwind CSS](https://tailwindcss.com)

---

## 📄 License

MIT License - feel free to use this project for personal or commercial purposes.
