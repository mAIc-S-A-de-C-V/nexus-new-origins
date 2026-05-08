# `src/design-system/`

Centralized color palette + 8 reusable components.

## `tokens.ts`

Exports a `colors` const used everywhere (or via CSS variables in `index.css`):

```
backgrounds:   base, surface, surfaceElevated
text:          text, textMuted, textSubtle
brand (violet #7C3AED):    brand, brandDim, brandBorder, brandText
interactive (blue #2563EB): interactive, interactiveDim, interactiveBorder
semantic:      warn, statusGreen, statusRed, statusYellow + dim variants
borders:       border, borderEmphasis
nav (dark):    navBg, navBorder, navText, navTextActive, navActiveBg
```

Usage pattern:
```typescript
import { colors } from '../../design-system/tokens';
<div style={{ backgroundColor: colors.brand, color: colors.brandText }} />
// OR use CSS variables in components: var(--color-brand)
```

## `components/` (8)

| Component | Purpose |
|-----------|---------|
| `Button.tsx` | Variants: primary / secondary / danger / ghost. |
| `Card.tsx` | Border + shadow + rounded corners wrapper. |
| `Badge.tsx` | Semantic badge (status/warning/success/info). |
| `Tag.tsx` | Inline small tag. |
| `StatusDot.tsx` | Colored dot indicator. |
| `Breadcrumb.tsx` | Reads from `navigationStore.breadcrumbs`. |
| `ThemeToggle.tsx` | Light/dark toggle (uses `useUiStore`). |
| `DensityToggle.tsx` | Comfortable/compact toggle. |

## When to edit

| Intent | File |
|--------|------|
| Change palette | `tokens.ts`. CSS-var consumers update automatically. |
| Add a component (e.g. `Modal`, `Tabs`) | new file in `components/`. |
| Add new variant to existing component | extend props union in component file. |
| Change typography scale | `index.css` (Inter / JetBrains Mono fonts). |
