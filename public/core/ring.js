// Geometry for the Focus Loop ring. Fractions run clockwise from the top.
export function ringPoint(fraction, radius, cx, cy) {
  const angle = (fraction % 1) * 2 * Math.PI - Math.PI / 2;
  return { x: +(cx + radius * Math.cos(angle)).toFixed(2), y: +(cy + radius * Math.sin(angle)).toFixed(2) };
}

export function elapsedFraction(startedAt, endsAt, now = Date.now()) {
  if (!(endsAt > startedAt)) return 0;
  return Math.min(1, Math.max(0, (now - startedAt) / (endsAt - startedAt)));
}
