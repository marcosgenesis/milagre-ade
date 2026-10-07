// Side panel motion, kept apart from React so it runs as worklets on the UI thread and in node tests alike.
// Progress is where the screen sits: 1 shows the left panel, -1 the right one, 0 neither.

/** Sideways speed, in points per second, past which a released drag goes where it was heading. */
const FLICK = 500;

/** Progress under the finger, kept inside what the gesture may reach. */
export function dragTo(from: number, translation: number, width: number, min: number, max: number) {
  "worklet";
  return Math.min(max, Math.max(min, from + translation / width));
}

/**
 * Where a released drag settles. Opening, a panel stays past a third of the width or on a flick toward it; closing,
 * it goes once a third has been pulled back or on a flick away.
 */
export function settle(from: number, progress: number, velocity: number) {
  "worklet";
  if (from === 0) {
    const side = Math.sign(progress);
    const toward = velocity * side;
    return toward > FLICK || (toward > -FLICK && Math.abs(progress) > 1 / 3) ? side : 0;
  }
  const back = -velocity * from;
  return back > FLICK || (back > -FLICK && progress * from < 2 / 3) ? 0 : from;
}
