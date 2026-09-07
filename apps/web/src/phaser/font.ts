/** 5×7 bitmap font (caps). Used for agent labels and roof titles. */
const GLYPHS: Record<string, number[]> = {
  " ": [0, 0, 0, 0, 0, 0, 0],
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [15, 17, 17, 15, 17, 17, 15],
  C: [14, 17, 1, 1, 1, 17, 14],
  D: [15, 17, 17, 17, 17, 17, 15],
  E: [31, 1, 1, 15, 1, 1, 31],
  F: [31, 1, 1, 15, 1, 1, 1],
  G: [14, 17, 1, 25, 17, 17, 14],
  H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14],
  J: [28, 8, 8, 8, 8, 9, 6],
  K: [17, 9, 5, 3, 5, 9, 17],
  L: [1, 1, 1, 1, 1, 1, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 19, 21, 25, 17, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [15, 17, 17, 15, 1, 1, 1],
  Q: [14, 17, 17, 17, 21, 9, 22],
  R: [15, 17, 17, 15, 5, 9, 17],
  S: [14, 17, 1, 14, 16, 17, 14],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 21, 10],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4],
  Z: [31, 16, 8, 4, 2, 1, 31],
  "0": [14, 17, 25, 21, 19, 17, 14],
  "1": [4, 6, 4, 4, 4, 4, 14],
  "2": [14, 17, 16, 8, 4, 2, 31],
  "3": [14, 17, 16, 12, 16, 17, 14],
  "4": [8, 12, 10, 9, 31, 8, 8],
  "5": [31, 1, 15, 16, 16, 17, 14],
  "6": [12, 2, 1, 15, 17, 17, 14],
  "7": [31, 16, 8, 4, 4, 4, 4],
  "8": [14, 17, 17, 14, 17, 17, 14],
  "9": [14, 17, 17, 30, 16, 8, 6],
  ".": [0, 0, 0, 0, 0, 6, 6],
  ",": [0, 0, 0, 0, 4, 4, 2],
  "!": [4, 4, 4, 4, 4, 0, 4],
  "?": [14, 17, 16, 8, 4, 0, 4],
  ":": [0, 4, 0, 0, 0, 4, 0],
  "-": [0, 0, 0, 14, 0, 0, 0],
  "_": [0, 0, 0, 0, 0, 0, 31],
  "/": [16, 16, 8, 4, 2, 1, 1],
  "'": [4, 4, 2, 0, 0, 0, 0],
};

export function measurePixelText(text: string): { w: number; h: number } {
  const t = text.toUpperCase();
  return { w: Math.max(1, t.length * 6), h: 7 };
}

export function drawPixelText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color = "#f3ead8",
  stroke = "#140f0c",
): void {
  const t = text.toUpperCase();
  let cx = x;
  for (const ch of t) {
    const g = GLYPHS[ch] ?? GLYPHS["?"];
    for (let row = 0; row < 7; row++) {
      const bits = g[row];
      for (let col = 0; col < 5; col++) {
        if (bits & (1 << col)) {
          ctx.fillStyle = stroke;
          ctx.fillRect(cx + col - 1, y + row, 1, 1);
          ctx.fillRect(cx + col + 1, y + row, 1, 1);
          ctx.fillRect(cx + col, y + row - 1, 1, 1);
          ctx.fillRect(cx + col, y + row + 1, 1, 1);
        }
      }
    }
    for (let row = 0; row < 7; row++) {
      const bits = g[row];
      for (let col = 0; col < 5; col++) {
        if (bits & (1 << col)) {
          ctx.fillStyle = color;
          ctx.fillRect(cx + col, y + row, 1, 1);
        }
      }
    }
    cx += 6;
  }
}

export function pixelTextTexture(scene: Phaser.Scene, key: string, text: string, color?: string): string {
  const { w, h } = measurePixelText(text);
  const canvas = document.createElement("canvas");
  canvas.width = w + 2;
  canvas.height = h + 2;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  drawPixelText(ctx, text, 1, 1, color);
  if (scene.textures.exists(key)) scene.textures.remove(key);
  scene.textures.addCanvas(key, canvas);
  return key;
}
