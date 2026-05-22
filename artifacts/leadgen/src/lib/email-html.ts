const HTML_TAG_PATTERN = /<\/?(?:a|b|blockquote|br|div|em|h[1-6]|hr|i|li|ol|p|span|strong|table|tbody|td|th|thead|tr|u|ul)\b[^>]*>/i;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function toPreviewHtml(value: string) {
  if (HTML_TAG_PATTERN.test(value)) return value;
  return escapeHtml(value).replace(/\n/g, "<br>");
}
