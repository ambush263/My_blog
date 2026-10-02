/* ==========================================================================
   markdown.js: turning Markdown text into safe HTML

   Pipeline:   Markdown text --marked--> HTML string --DOMPurify--> safe HTML

   Why two steps? marked only converts syntax; it does NOT make the result safe.
   If someone pastes  <script>alert(1)</script>  or  <img onerror="...">  into
   a post, marked passes it straight through. DOMPurify then strips anything
   dangerous (scripts, inline event handlers, javascript: links...).

   This file exposes one global object: BlogMarkdown
   ========================================================================== */

const BlogMarkdown = (function () {

  /*
    How images are referenced inside a post body.
    Uploaded images are stored in IndexedDB, so the Markdown contains a
    placeholder path with the image's key:

        ![diagram](local-image/img_k3j2h1_ab12cd)

    We use a relative-looking path (no "scheme:" part) on purpose, because
    DOMPurify removes URLs with unknown schemes like "img:".
  */
  const IMAGE_PREFIX = 'local-image/';

  /* ------------------------------------------------------------------
     setup(): runs once when the file loads.
     Configures marked and registers a DOMPurify "hook".
     A hook is a function DOMPurify calls for every element it cleans,
     which lets us make small adjustments to the safe output.
     ------------------------------------------------------------------ */
  function setup() {
    if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') {
      return; // CDN failed to load (offline?). render() has a fallback.
    }

    // gfm = GitHub Flavored Markdown (tables, task lists, ~~strike~~).
    marked.setOptions({ gfm: true, breaks: false });

    DOMPurify.addHook('afterSanitizeAttributes', function (node) {
      // 1. Images: swap our placeholder path for a data attribute.
      //    The real image data is in IndexedDB, which is asynchronous, so
      //    app.js fills in the real `src` later (see hydrateImages in app.js).
      //    Removing `src` here also stops the browser from requesting a
      //    file called "local-image/..." that doesn't exist.
      if (node.tagName === 'IMG') {
        const src = node.getAttribute('src') || '';
        if (src.indexOf(IMAGE_PREFIX) === 0) {
          node.setAttribute('data-image-key', src.slice(IMAGE_PREFIX.length));
          node.removeAttribute('src');
        }
        node.setAttribute('loading', 'lazy');
      }

      // 2. External links open in a new tab. rel="noopener noreferrer"
      //    stops the new page from getting access to ours.
      if (node.tagName === 'A') {
        const href = node.getAttribute('href') || '';
        if (/^https?:/i.test(href)) {
          node.setAttribute('target', '_blank');
          node.setAttribute('rel', 'noopener noreferrer');
        }
      }
    });
  }

  /* ------------------------------------------------------------------
     render(markdown): Markdown string in, SAFE HTML string out.
     Always insert the result with innerHTML only after going through here.
     ------------------------------------------------------------------ */
  function render(markdown) {
    const source = markdown || '';

    // Fallback if the CDN scripts didn't load: show plain text, safely escaped.
    if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') {
      return '<p><em>The Markdown library could not be loaded (are you offline?). ' +
             'Showing plain text instead.</em></p><pre>' + escapeHtml(source) + '</pre>';
    }

    const rawHtml = marked.parse(source);  // Markdown -> HTML (unsafe)
    return DOMPurify.sanitize(rawHtml);    // HTML -> safe HTML
  }

  /* ------------------------------------------------------------------
     makeExcerpt(markdown, maxLength): a short plain-text preview for cards.
     We strip Markdown symbols with a few simple regular expressions.
     It's not a perfect parser, but it's good enough for a preview.
     ------------------------------------------------------------------ */
  function makeExcerpt(markdown, maxLength) {
    const limit = maxLength || 150;

    const text = (markdown || '')
      .replace(/```[\s\S]*?```/g, ' ')          // fenced code blocks
      .replace(/`([^`]*)`/g, '$1')              // inline code
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')    // images
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')  // links: keep the link text
      .replace(/<[^>]+>/g, ' ')                 // raw HTML tags
      .replace(/^\s{0,3}#{1,6}\s+(.+)$/gm, '$1.')            // headings become short sentences
      .replace(/^\s{0,3}(>|[-*+]|\d+\.)\s+/gm, '')          // quote/list markers
      .replace(/[*_~]/g, '')                    // bold / italic / strike marks
      .replace(/\s+/g, ' ')                     // collapse whitespace
      .trim();

    if (text.length <= limit) return text;
    // Cut at the last space before the limit so we don't slice a word in half.
    const cut = text.slice(0, limit);
    return cut.slice(0, cut.lastIndexOf(' ') > 40 ? cut.lastIndexOf(' ') : limit) + '…';
  }

  /* ------------------------------------------------------------------
     escapeHtml(text): turns  <  >  &  "  '  into harmless entities.
     Use this on any user-typed text (titles, tags) that you put inside an
     HTML template string. Otherwise a title like  <b>hi</b>  would be
     interpreted as real HTML.
     ------------------------------------------------------------------ */
  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  setup();

  // Public API: only these are visible outside this file.
  return {
    IMAGE_PREFIX: IMAGE_PREFIX,
    render: render,
    makeExcerpt: makeExcerpt,
    escapeHtml: escapeHtml
  };
})();
