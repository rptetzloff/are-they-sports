/** Escaping, in one place.
 *
 *  Both the renderer and the record core need it: the core's streak sentence is
 *  HTML on purpose — it bolds the numbers, which is what both sites do — and a
 *  sentence that interpolates a club's name has to escape it like anything else.
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
