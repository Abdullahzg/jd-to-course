/**
 * Take the dashes out of model prose.
 *
 * The summary prompt has said "Never use an em dash or an en dash" for a long
 * time and the model wrote them anyway: a shipped plan page read "the roadmap
 * work itself—prioritizing features against effort—which you will have to pick
 * up on the job". A prompt is a request, not a guarantee, so the guarantee is
 * made here instead.
 *
 * A dash between words is doing the work of a comma, so it becomes one. A dash
 * between digits is a range, so it becomes the word. Hyphens are left alone.
 */
export function noDashes(s: string): string {
  return s
    .replace(/(\d)\s*[–—]\s*(\d)/g, "$1 to $2")
    .replace(/\s*[—―]\s*/g, ", ")
    .replace(/\s+[–]\s+/g, ", ")
    // A comma the dash introduced next to punctuation the sentence already had.
    .replace(/,\s*([,.;:!?])/g, "$1")
    .replace(/([,.;:])\s*,/g, "$1")
    .replace(/\s{2,}/g, " ");
}
