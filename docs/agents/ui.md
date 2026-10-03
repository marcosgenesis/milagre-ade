# UI rules

## Scrolling

Every scrolling list or panel is a `ScrollArea` (`app/src/components/primitives/ScrollArea.tsx`). It brings vertical scroll that stays inside the container, the shared thin scrollbar and edge fades that show only while there's more to scroll that way. Pass `as="ul"` for lists, and `chainScroll` when it sits inside another scroller (tool output in the transcript, a list inside a scrolling dialog) so the wheel moves on to the outer one at the end.

- Don't add `overflow-y-auto` plus `useScrollFade` by hand, and don't restyle the scrollbar in a component. The one scrollbar look is the `::-webkit-scrollbar` block in `app/src/styles.css`. Hiding a scrollbar where a custom rail replaces it (the message scroller) is fine.
- Give a scroll area a height limit. Popovers anchored above the composer get one from `useAnchoredPopover` (`height`, 360px by default); put the `ScrollArea` inside the popover's `flex flex-col overflow-hidden` panel so it takes the leftover space.

`app/src/components/primitives/scroll-area-only.test.ts` fails when a component scrolls vertically without `ScrollArea`, wires fades or restyles the scrollbar itself. The only exceptions are `<pre>` code blocks, which scroll both ways, and the message scroller.

## Choices

Every dropdown goes through `primitives/Select`; a native `<select>` opens macOS's own menu. `no-native-select.test.ts` enforces it.

## Sliders

Every slider is a `RangeSlider` (`app/src/components/primitives/RangeSlider.tsx`): tick dots per step, a bar handle that bounces as it lands, drag anywhere on the track or use the arrow keys, and no springs under reduced motion. Its value plumbing is `lib/use-slider.ts`; a native `<input type="range">` draws macOS's own control.

## Backdrop blur

Three blur strengths, all theme tokens in `app/src/styles.css`:

- `backdrop-blur-overlay` (3px) on the scrim behind a dialog, palette or viewer. It softens the app behind without hiding it; pair it with a dark tint for contrast.
- `backdrop-blur-chip` (8px) on a small control that sits over media, such as the copy and download buttons on a generated image.
- `backdrop-blur-edge` (4px) where content scrolls under a window edge, faded out with a mask (`.chat-top-blur`, `.chat-bottom-blur`).

Don't use Tailwind's own sizes (`backdrop-blur-sm` to `-3xl`) or a hand-written `backdrop-filter: blur(...)`; a stronger blur behind a full-window scrim also costs frames while something animates over it. CSS that needs the value uses the variable, e.g. `blur(var(--blur-overlay))`. `primitives/backdrop-blur.test.ts` enforces it.
