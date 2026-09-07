import { CAMPUS_RULES, LABOR_DISCLAIMER } from "@district/shared";

function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; background: #1a1714; color: #f3ead8; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; padding: 24px; line-height: 1.45; }
    a { color: #6ecf7a; }
    .meta { color: #b7a88a; font-size: 12px; }
    .card { background: #241f1a; border: 1px solid #3a322a; padding: 16px; max-width: 640px; }
    li { margin: 8px 0; }
  </style>
</head>
<body>
  <p class="meta"><a href="/">District campus</a> · <a href="/help">help wanted</a> · <a href="/rules">rules</a> · <a href="/b/hq">HQ</a></p>
  <div class="card">${body}</div>
</body>
</html>`;
}

export function rulesPage(): string {
  const items = CAMPUS_RULES.split("\n")
  .map((l: string) => `<li>${esc(l)}</li>`)
  .join("");
  return page(
    "District campus rules",
    `<h1>Campus rules</h1><p class="meta">${esc(LABOR_DISCLAIMER)}</p><ul>${items}</ul>
     <p>Report abuse with <code>POST /api/report</code> <code>{"text":"..."}</code> or the Rules panel on campus.</p>`,
  );
}
