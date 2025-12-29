# Room Planner

A visual room planning tool built with React, Vite, and Tailwind CSS. Design your room layout by configuring dimensions, adding furniture, and arranging items with an intuitive drag-and-drop interface.

## Features

- 📐 **Flexible Room Dimensions** - Support for feet/inches input (e.g., 12'6" or 150")
- 🚪 **Configurable Door** - Position and swing direction controls
- 🪑 **Furniture Management** - Add, resize, rotate, and arrange furniture items
- 💾 **Save & Share** - Export/import via URL or JSON configuration
- 📱 **Responsive Design** - Works on desktop and mobile devices
- 🎨 **Visual Customization** - Color-coded furniture items

## Getting Started

### Prerequisites

- Node.js (version 16 or higher)
- npm or yarn

### Installation

1. Clone the repository or navigate to the project folder:

```bash
cd room-planner
```

1. Install dependencies:

```bash
npm install
```

1. Start the development server:

```bash
npm run dev
```

1. Open your browser and visit the URL shown in the terminal (typically `http://localhost:5173`)

## Available Scripts

- `npm run dev` - Start the development server with hot reload
- `npm run build` - Build the production-ready app
- `npm run preview` - Preview the production build locally

## Usage

### Configure Mode

1. Set your room dimensions (width and length)
2. Configure the door position and swing direction
3. Add furniture items and set their dimensions
4. Customize labels and colors

### Arrange Mode

1. Switch to "Arrange" mode using the toggle
2. Drag furniture items to reposition them
3. Use the rotation handle to rotate items
4. Items snap to 45° angles for easy alignment

### Share & Save

1. Click "Share / Save" button
2. Copy the direct link to share your layout
3. Or export/import JSON configuration for backup

## Deployment

### Deploying to Static Hosting

Build the production version:

```bash
npm run build
```

The `dist` folder will contain your production-ready files. You can deploy this folder to:

- **Netlify**: Drag and drop the `dist` folder or connect your Git repository
- **Vercel**: Import your project and it will auto-detect Vite configuration
- **GitHub Pages**:
  1. Add `base: '/room-planner/'` to `vite.config.js` (replace with your repo name)
  2. Build and push the `dist` folder to a `gh-pages` branch
- **Any static host**: Upload the contents of the `dist` folder

### Quick Deploy Examples

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

## Technology Stack

- **React 18** - UI framework
- **Vite** - Build tool and dev server
- **Tailwind CSS** - Utility-first CSS framework
- **Lucide React** - Icon library
- **Local Storage** - Persistent state management

## Browser Support

Works on all modern browsers that support ES6+ and CSS Grid.

## License

MIT

## Contributing

Feel free to submit issues and enhancement requests!
