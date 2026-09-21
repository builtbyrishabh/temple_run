/** Shift a repeating track row by less than one gap as the camera advances. */
export function trackTravelOffset(cameraZ: number, spacing: number): number {
  const travelled = ((cameraZ % spacing) + spacing) % spacing;
  return travelled;
}

/** Place one recycled scenery slot ahead of the camera, wrapping behind fog. */
export function recycledRowZ(
  cameraZ: number,
  slot: number,
  spacing: number,
  slots: number,
  near: number,
): number {
  const span = slots * spacing;
  const relative = (((slot * spacing - cameraZ) % span) + span) % span;
  return -(relative + near);
}
