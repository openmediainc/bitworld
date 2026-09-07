import { SPRITE_COLORS, TILE_SIZE, type SpriteId } from "@district/shared";

const DIRS = ["down", "left", "right", "up"] as const;

function px(ctx: CanvasRenderingContext2D, x: number, y: number, c: string): void {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, 1, 1);
}

function drawBody(ctx: CanvasRenderingContext2D, color: string, frame: number, visitor: boolean): void {
  const skin = visitor ? "#e8c4a0" : "#f0c8a0";
  const hair = visitor ? "#2a3344" : shade(color, -40);
  const hoodie = visitor ? "#3D6EA8" : color;
  const dark = shade(hoodie, -30);
  const bob = frame;
  for (let x = 5; x <= 10; x++) px(ctx, x, 1 + bob, hair);
  for (let x = 4; x <= 11; x++) px(ctx, x, 2 + bob, hair);
  for (let x = 5; x <= 10; x++) px(ctx, x, 3 + bob, skin);
  px(ctx, 6, 3 + bob, "#222");
  px(ctx, 9, 3 + bob, "#222");
  for (let y = 5; y <= 9; y++) {
    for (let x = 4; x <= 11; x++) px(ctx, x, y, hoodie);
  }
  px(ctx, 4, 6, dark);
  px(ctx, 11, 6, dark);
  const leg = frame === 0 ? 10 : 11;
  px(ctx, 6, 10, dark);
  px(ctx, 9, 10, dark);
  px(ctx, 6, leg, "#2a2420");
  px(ctx, 9, 21 - leg, "#2a2420");
  if (visitor) {
    px(ctx, 5, 7, "#d7e7ff");
    px(ctx, 10, 7, "#d7e7ff");
  }
}

function shade(hex: string, amt: number): string {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

export function ensureSpriteTextures(scene: Phaser.Scene): void {
  const ids: SpriteId[] = ["kael", "yuki", "nora", "rex", "iris", "cobb", "lark", "moss", "visitor"];
  for (const id of ids) {
    const key = `sprite-${id}`;
    if (scene.textures.exists(key)) continue;
    const canvas = document.createElement("canvas");
    canvas.width = 16 * 4;
    canvas.height = 16 * 2;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    for (let d = 0; d < 4; d++) {
      for (let f = 0; f < 2; f++) {
        ctx.save();
        ctx.translate(d * 16, f * 16);
        drawBody(ctx, SPRITE_COLORS[id] ?? "#888", f, id === "visitor");
        ctx.restore();
      }
    }
    scene.textures.addCanvas(key, canvas);
    for (let d = 0; d < 4; d++) {
      for (let f = 0; f < 2; f++) {
        scene.textures.get(key).add(`${DIRS[d]}-${f}`, 0, d * 16, f * 16, 16, 16);
      }
    }
  }
}

export function dirIndex(facing: string): number {
  return Math.max(0, DIRS.indexOf(facing as (typeof DIRS)[number]));
}

export { TILE_SIZE };
