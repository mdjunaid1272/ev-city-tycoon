/**
 * Cars give way to the player: a car brakes to a stop in front of the character when they stand on its way
 * and drives off again as soon as the character steps aside. Shared by road traffic and lot vehicles.
 */
export const playerYield = { pos: null, radius: 0.42 };

const LOOK = 9; // metres ahead that count

/**
 * Free distance between the front of `obj` and the player, or Infinity when the player is not ahead of the car
 * within its lane. Uses the car's world matrix (forward = -Z, right = +X); length / width from userData.
 */
export function gapToPlayer(obj, lenFallback = 4.2) {
  const p = playerYield.pos;
  if (!p || !obj.parent) return Infinity;
  // cars sit directly under identity-transform roots, so position / rotation.y are the world values (and always current)
  const cx = obj.position.x, cz = obj.position.z, yaw = obj.rotation.y;
  const dx = p.x - cx, dz = p.z - cz;
  if (dx * dx + dz * dz > (LOOK + 4) * (LOOK + 4)) return Infinity;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const len = obj.userData.length || lenFallback, wid = obj.userData.width || 1.9;
  const along = dx * fx + dz * fz;
  const lat = dx * rx + dz * rz;
  if (along <= 0 || along > LOOK + len / 2) return Infinity;
  if (Math.abs(lat) > wid / 2 + playerYield.radius + 0.35) return Infinity;
  return along - len / 2 - playerYield.radius;
}

/** Speed limit (m/s) that lets a car stop about 1.5 m before the player with a comfortable deceleration. */
export function speedLimitForPlayer(obj, decel = 6) {
  const gap = gapToPlayer(obj);
  if (gap === Infinity) return Infinity;
  return Math.sqrt(2 * decel * Math.max(0, gap - 1.5));
}
