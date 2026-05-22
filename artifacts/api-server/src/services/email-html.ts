const HTML_TAG_PATTERN = /<\/?(?:a|b|blockquote|br|div|em|h[1-6]|hr|i|li|ol|p|span|strong|table|tbody|td|th|thead|tr|u|ul)\b[^>]*>/i;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function isHtmlEmailBody(value: string): boolean {
  return HTML_TAG_PATTERN.test(value);
}

export function toHtmlEmail(value: string): string {
  if (isHtmlEmailBody(value)) return value;
  return escapeHtml(value).replace(/\n/g, "<br>");
}

export function toTextEmail(value: string): string {
  if (!isHtmlEmailBody(value)) return value;
  return decodeBasicEntities(
    value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

export function appendUnsubscribeFooter(body: string, unsubscribeFooter: string | null | undefined): string {
  if (!unsubscribeFooter) return body;

  if (isHtmlEmailBody(body)) {
    return `${body}<hr><p>${escapeHtml(unsubscribeFooter).replace(/\n/g, "<br>")}</p>`;
  }

  return `${body}\n\n---\n${unsubscribeFooter}`;
}
