/* Blog content rendering.
   Stored content is plain text (see the admin editor): a blank line starts a paragraph and a line
   beginning with "## " is a heading. It is rendered as React elements rather than HTML, so a
   post can never inject script into the page — nothing in the blog is ever passed to
   dangerouslySetInnerHTML. */

export type Block = { type: "h2" | "p"; text: string };

export function blocks(content: string): Block[] {
  const out: Block[] = [];
  for (const chunk of String(content || "").split(/\n{2,}/)) {
    const parts = chunk.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const line of parts) {
      const h = line.match(/^#{2,3}\s*(.+)$/);
      if (h) out.push({ type: "h2", text: h[1].replace(/\*\*/g, "").trim() });
      else out.push({ type: "p", text: line.replace(/\*\*/g, "").replace(/^[-*]\s+/, "· ") });
    }
  }
  return out;
}

export function readingMinutes(content: string): number {
  const words = String(content || "").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

export const dateLabel = (d: Date | string) =>
  new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

/* URL-safe slug from a title (matches lib/slug's behaviour closely enough for links built here) */
export function slugFrom(title: string): string {
  return String(title || "").toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 70);
}
