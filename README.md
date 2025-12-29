# 🏠 Room Planner

A powerful, intuitive room planning tool for designing and visualizing room layouts. Built with React, Vite, and Tailwind CSS.

![Room Planner](https://img.shields.io/badge/version-1.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

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

| System | Example | Use Case |
|--------|---------|----------|
| Feet & Inches | `12'6"` | US residential |
| Decimal Feet | `12.5 ft` | US commercial |
| Inches | `150 in` | Detailed work |
| Meters | `3.8 m` | International |
| Centimeters | `380 cm` | Precision metric |

**Tip:** You can type values with any unit suffix and they'll convert automatically!

### Saving & Sharing

- **Auto-Save** - Your work saves automatically to your browser
- **My Floor Plans** - Click the folder icon to manage multiple projects
- **Share Link** - Click "Share / Save" to get a URL with your complete layout
- **Export JSON** - Download a backup file you can import later

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/⌘ + Z` | Undo |
| `Ctrl/⌘ + Shift + Z` | Redo |
| `Delete` / `Backspace` | Delete selected item |
| `Escape` | Deselect item |
| `Arrow Keys` | Move selected item (0.25 ft) |
| `Shift + Arrow Keys` | Move selected item (1 ft) |
| `R` | Rotate selected item 90° |

### Visual Indicators

| Indicator | Meaning |
|-----------|---------|
| 🔴 Red border + ⚠️ | Furniture overlaps another item or extends outside room |
| 🟡 Amber border + 🔒 | Item is locked (cannot be moved or resized) |
| 👁️ Dashed border | Item is hidden (won't appear in final layout) |

---

## 🚀 Development

### Prerequisites

- **Node.js** 16.0 or higher
- **npm** or **yarn**

### Getting Started

```bash
# Clone the repository
git clone https://github.com/yourusername/room-planner.git
cd room-planner

# Install dependencies
npm install

# Start development server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Build for Production

```bash
npm run build
```

The optimized build will be in the `dist` folder.

### Project Structure

```
room-planner/
├── public/
│   └── manifest.json      # PWA manifest
├── src/
│   ├── App.jsx           # Main application component (~3800 lines)
│   ├── main.jsx          # React entry point
│   ├── index.css         # Tailwind CSS + custom styles
│   └── Knob.js           # Rotation control component
├── index.html            # HTML template
├── package.json          # Dependencies and scripts
├── vite.config.js        # Vite configuration
├── tailwind.config.js    # Tailwind configuration
└── postcss.config.js     # PostCSS configuration
```

### Key Components

| Component/Function | Purpose |
|-------------------|---------|
| `RoomSimulator` | Main component containing all state and logic |
| `DimensionInput` | Smart input that parses various unit formats |
| `ColorPicker` | Preset and custom color selection |
| `Modal` | Reusable modal dialog |
| `Tooltip` | Hover tooltips for buttons |

### Architecture Notes

- All measurements are stored internally in **feet**, converted for display based on unit system
- Colors are stored as **hex values** for consistent sharing across browsers
- State is managed with React hooks; projects persist to `localStorage`
- The app is primarily a single component (`App.jsx`) for simplicity

---

## 🚢 Deployment

Build and deploy the `dist` folder to any static host:

**Netlify:**

```bash
npm run build
npx netlify-cli deploy --prod --dir=dist
```

**Vercel:**

```bash
npm run build
npx vercel --prod
```

**GitHub Pages:**

1. Add to `vite.config.js`:

   ```js
   export default defineConfig({
     base: '/room-planner/',
     // ... other config
   })
   ```

2. Build and deploy to `gh-pages` branch

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
- [ ] Reloading the page with a shared link causes a duplicate floor plan to be added with the same name

---

## 🛠️ Technology Stack

| Technology | Purpose |
|------------|---------|
| [React 18](https://react.dev) | UI framework with hooks |
| [Vite](https://vitejs.dev) | Fast build tool and dev server |
| [Tailwind CSS](https://tailwindcss.com) | Utility-first styling |
| [Lucide React](https://lucide.dev) | Beautiful icon library |
| LocalStorage | Client-side persistence |

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

- **[Knobs](https://jherrm.github.io/knobs/)** by [@jherrm](https://github.com/jherrm/knobs) - Rotation knob component inspiration
- Icons by [Lucide](https://lucide.dev)
- Built with [Vite](https://vitejs.dev) + [React](https://react.dev)
- Styled with [Tailwind CSS](https://tailwindcss.com)

---

## 📄 License

MIT License - feel free to use this project for personal or commercial purposes.
