import { AVENUE_KM0, FOUNTAIN, RENDER_ZOOM, TILE_SIZE } from "@district/shared";

export function bindCamera(scene: Phaser.Scene): void {
  const cam = scene.cameras.main;
  cam.setZoom(RENDER_ZOOM);
  cam.roundPixels = true;
  cam.centerOn((FOUNTAIN.x + 1) * TILE_SIZE, (FOUNTAIN.y + 1) * TILE_SIZE);
  scene.input.on("pointermove", (p: Phaser.Input.Pointer) => {
    if (!p.isDown) return;
    if ((p.event as PointerEvent).target && (p.event as PointerEvent).target !== scene.game.canvas) return;
    cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
    cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
  });
  scene.input.on("wheel", (_p: unknown, _g: unknown, _dx: number, dy: number) => {
    const z = Phaser.Math.Clamp(cam.zoom - Math.sign(dy) * 0.25, 2, 5);
    cam.setZoom(z);
  });
}

export function centerFountain(scene: Phaser.Scene): void {
  scene.cameras.main.centerOn((FOUNTAIN.x + 1) * TILE_SIZE, (FOUNTAIN.y + 1) * TILE_SIZE);
}

export function centerAvenue(scene: Phaser.Scene): void {
  scene.cameras.main.centerOn((AVENUE_KM0.x + 1) * TILE_SIZE, (AVENUE_KM0.y + 1) * TILE_SIZE);
}
