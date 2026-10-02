# UI rules

## Scrolling

Every scrolling list or panel is a `ScrollArea` (`app/src/components/primitives/ScrollArea.tsx`). It brings vertical scroll that stays inside the container, the shared thin scrollbar and edge fades that show only while there's more to scroll that way. Pass `as="ul"` for lists.

- Don't add `overflow-y-auto` plus `useScrollFade` by hand, and don't restyle the scrollbar in a component. The one scrollbar look is the `::-webkit-scrollbar` block in `app/src/styles.css`. Hiding a scrollbar where a custom rail replaces it (the message scroller) is fine.
- Give a scroll area a height limit. Popovers anchored above the composer get one from `useAnchoredPopover` (`height`, 360px by default); put the `ScrollArea` inside the popover's `flex flex-col overflow-hidden` panel so it takes the leftover space.

`app/src/components/primitives/scroll-area-only.test.ts` fails when a component wires fades or restyles the scrollbar itself.

## Choices

Every dropdown goes through `primitives/Select`; a native `<select>` opens macOS's own menu. `no-native-select.test.ts` enforces it.
