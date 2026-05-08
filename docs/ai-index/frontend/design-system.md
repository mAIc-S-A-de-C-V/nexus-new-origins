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

## `components/` (9)

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
| `Select.tsx` (NEW 2026-05) | Drop-in replacement for native `<select>` with typeahead, keyboard nav, theme-matching popover. |

### `Select` — typeahead replacement for native dropdowns

Native `<select>` renders with browser/OS chrome (dark on macOS) and has no built-in search. `Select` replaces it with a styled `<button>` + popover + filterable list. Same `value` / `onChange` API for mechanical swapping at the call site.

```tsx
import { Select } from '../../design-system/components/Select';

<Select
  value={objectTypeId}
  onChange={setObjectTypeId}
  placeholder="— select an object type —"
  clearable
  options={[
    { value: 'a1', label: 'Devices', hint: '12k records' },
    { value: 'b2', label: 'Tickets', hint: '350 records' },
  ]}
/>
```

Options can also be `string[]` for simple cases. Optional `group` field on each option produces section headers in the popover. Optional `disabled` greys out an option. Keyboard nav: Enter/Space/↓ to open, ↑/↓ to move, Enter to select, Esc to close. Popover is `position: fixed` so it escapes any `overflow: hidden` ancestor.

**Where to use it:** anywhere a `<select>` would go — block config pickers, filter rows, settings dropdowns, tenant pickers, etc. Until rolled out everywhere, the global CSS in `index.css` normalizes any leftover native `<select>` so it doesn't render dark.

**Rollout status (2026-05):**
- ✅ `LogicStudio` — Object Type, Filters (field + op), Aggregate (group_by, time_bucket field+interval, per-aggregation method/field), Transform operation, LLM model picker.
- ⏳ `AgentStudio`, `SettingsPage`, `ApprovalsTab`, `CheckpointsTab`, `ScenariosPage` — still using native selects (CSS-styled). Replace incrementally.

## When to edit

| Intent | File |
|--------|------|
| Change palette | `tokens.ts`. CSS-var consumers update automatically. |
| Add a component (e.g. `Modal`, `Tabs`) | new file in `components/`. |
| Add new variant to existing component | extend props union in component file. |
| Change typography scale | `index.css` (Inter / JetBrains Mono fonts). |
