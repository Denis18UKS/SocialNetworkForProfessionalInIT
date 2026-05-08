import { rewriteLocalhostApiUrl } from "./settings";

const shouldRewrite = (value: unknown): value is string =>
  typeof value === "string" && /^http:\/\/localhost:5000/i.test(value);

const rewriteMaybe = (value: unknown) => {
  if (!shouldRewrite(value)) return value;
  const rewritten = rewriteLocalhostApiUrl(value);
  return rewritten === value ? value : rewritten;
};

export const installNetworkUrlRewrite = () => {
  const windowWithRewriteFlag = window as typeof window & { __itbirdNetworkRewriteInstalled?: boolean };
  if (windowWithRewriteFlag.__itbirdNetworkRewriteInstalled) return;
  windowWithRewriteFlag.__itbirdNetworkRewriteInstalled = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === "string") {
      return originalFetch(rewriteLocalhostApiUrl(input), init);
    }

    if (input instanceof URL && shouldRewrite(input.href)) {
      return originalFetch(new URL(rewriteLocalhostApiUrl(input.href)), init);
    }

    if (input instanceof Request && shouldRewrite(input.url)) {
      return originalFetch(new Request(rewriteLocalhostApiUrl(input.url), input), init);
    }

    return originalFetch(input, init);
  }) as typeof window.fetch;

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function patchedOpen(
    method: string,
    url: string | URL,
    async = true,
    username?: string | null,
    password?: string | null
  ) {
    const nextUrl = typeof url === "string" ? rewriteLocalhostApiUrl(url) : new URL(rewriteLocalhostApiUrl(url.href));
    return originalOpen.call(this, method, nextUrl, async, username, password);
  };

  const originalSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function patchedSetAttribute(name: string, value: string) {
    const attrName = name.toLowerCase();
    const nextValue = ["src", "href", "poster", "action"].includes(attrName) ? rewriteMaybe(value) : value;

    return originalSetAttribute.call(this, name, String(nextValue));
  };

  const patchUrlProperty = <T extends Element>(proto: T, property: "src" | "href" | "poster" | "action") => {
    const descriptor = Object.getOwnPropertyDescriptor(proto, property);
    if (!descriptor?.set || !descriptor.get) return;

    Object.defineProperty(proto, property, {
      configurable: true,
      enumerable: descriptor.enumerable,
      get() {
        return descriptor.get?.call(this);
      },
      set(value: string) {
        descriptor.set?.call(this, rewriteMaybe(value));
      },
    });
  };

  patchUrlProperty(HTMLImageElement.prototype, "src");
  patchUrlProperty(HTMLMediaElement.prototype, "src");
  patchUrlProperty(HTMLSourceElement.prototype, "src");
  patchUrlProperty(HTMLAnchorElement.prototype, "href");
  patchUrlProperty(HTMLFormElement.prototype, "action");

  const rewriteExistingElement = (element: Element) => {
    ["src", "href", "poster", "action"].forEach((attribute) => {
      const value = element.getAttribute(attribute);
      if (!shouldRewrite(value)) return;
      const rewritten = rewriteLocalhostApiUrl(value);
      if (rewritten !== value) element.setAttribute(attribute, rewritten);
    });
  };

  document.querySelectorAll("[src], [href], [poster], [action]").forEach(rewriteExistingElement);
  new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === "attributes" && mutation.target instanceof Element) {
        rewriteExistingElement(mutation.target);
      }
      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        rewriteExistingElement(node);
        node.querySelectorAll("[src], [href], [poster], [action]").forEach(rewriteExistingElement);
      });
    });
  }).observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["src", "href", "poster", "action"],
  });
};
