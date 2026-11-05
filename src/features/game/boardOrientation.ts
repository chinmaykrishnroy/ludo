import { COLORS, type Color } from "../../../shared/game";

export type BoardRotation = 0 | 90 | 180 | 270;

export function rotationForHome(color: Color | undefined): BoardRotation {
  return color ? ([270, 180, 90, 0] as const)[COLORS.indexOf(color)] : 0;
}

function rotatePoint(
  x: number,
  y: number,
  extent: number,
  rotation: BoardRotation,
): [number, number] {
  switch (rotation) {
    case 90:
      return [extent - y, x];
    case 180:
      return [extent - x, extent - y];
    case 270:
      return [y, extent - x];
    default:
      return [x, y];
  }
}

export function orientCell(
  [row, column]: [number, number],
  rotation: BoardRotation,
): [number, number] {
  return rotatePoint(column, row, 14, rotation);
}

export function homeOrigin(color: Color, rotation: BoardRotation) {
  const i = COLORS.indexOf(color);
  return rotatePoint(
    i === 1 || i === 2 ? 80 : 20,
    i >= 2 ? 80 : 20,
    100,
    rotation,
  );
}
