import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const SITE_ORIGIN = "https://socialbird.31.207.74.138.nip.io";

const upsertMeta = (selector: string, attributes: Record<string, string>) => {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement("meta");
    document.head.appendChild(element);
  }
  Object.entries(attributes).forEach(([key, value]) => element?.setAttribute(key, value));
};

const upsertLink = (rel: string, href: string) => {
  let element = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!element) {
    element = document.createElement("link");
    element.rel = rel;
    document.head.appendChild(element);
  }
  element.href = href;
};

const normalizePath = (pathname: string) => {
  const path = pathname.replace(/\/+$/, "") || "/";
  return path;
};

const routeSeo = (pathname: string) => {
  const path = normalizePath(pathname);

  if (path === "/") {
    return {
      title: "SocialBIRD — социальная сеть для IT-специалистов",
      description:
        "SocialBIRD — социальная сеть для программистов и IT-специалистов: профессиональное общение, посты, чаты, голосовые и видеозвонки, IT-хакатоны и онлайн-компилятор.",
      robots: "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1",
      type: "website",
    };
  }

  if (path === "/xakatons") {
    return {
      title: "IT-хакатоны — SocialBIRD",
      description:
        "Актуальные IT-хакатоны, соревнования и мероприятия для разработчиков в SocialBIRD.",
      robots: "index,follow,max-image-preview:large,max-snippet:-1",
      type: "website",
    };
  }

  if (path === "/compiler") {
    return {
      title: "Онлайн-компилятор для разработчиков — SocialBIRD",
      description:
        "Запускайте код прямо в браузере в изолированной среде SocialBIRD. Онлайн-компилятор для популярных языков программирования.",
      robots: "index,follow,max-image-preview:large,max-snippet:-1",
      type: "website",
    };
  }

  if (path === "/android-app") {
    return {
      title: "SocialBIRD для Android — скачать приложение",
      description:
        "Скачайте официальное Android-приложение SocialBIRD: чаты, звонки, уведомления, камера, микрофон и системная демонстрация экрана.",
      robots: "index,follow,max-image-preview:large,max-snippet:-1",
      type: "website",
    };
  }

  if (path.startsWith("/users-profiles/")) {
    return {
      title: "Профиль IT-специалиста — SocialBIRD",
      description: "Публичный профиль пользователя профессиональной IT-сети SocialBIRD.",
      robots: "index,follow,max-image-preview:large,max-snippet:-1",
      type: "profile",
    };
  }

  if (path.startsWith("/forums/")) {
    return {
      title: "IT-форум — SocialBIRD",
      description: "Вопросы, ответы и обсуждения сообщества разработчиков SocialBIRD.",
      robots: "index,follow,max-image-preview:large,max-snippet:-1",
      type: "article",
    };
  }

  if (path === "/forum") {
    return {
      title: "Форум разработчиков — SocialBIRD",
      description: "Форум SocialBIRD: вопросы, ответы и профессиональные обсуждения для IT-специалистов.",
      robots: "index,follow,max-image-preview:large,max-snippet:-1",
      type: "website",
    };
  }

  return {
    title: "SocialBIRD",
    description: "Социальная сеть и рабочее пространство для IT-специалистов.",
    robots: "noindex,nofollow",
    type: "website",
  };
};

const SeoManager = () => {
  const location = useLocation();

  useEffect(() => {
    const path = normalizePath(location.pathname);
    const seo = routeSeo(path);
    const canonical = `${SITE_ORIGIN}${path === "/" ? "" : path}`;

    document.title = seo.title;
    document.documentElement.lang = document.documentElement.lang || "ru";

    upsertMeta('meta[name="description"]', { name: "description", content: seo.description });
    upsertMeta('meta[name="robots"]', { name: "robots", content: seo.robots });
    upsertMeta('meta[name="googlebot"]', { name: "googlebot", content: seo.robots });
    upsertMeta('meta[property="og:title"]', { property: "og:title", content: seo.title });
    upsertMeta('meta[property="og:description"]', { property: "og:description", content: seo.description });
    upsertMeta('meta[property="og:type"]', { property: "og:type", content: seo.type });
    upsertMeta('meta[property="og:url"]', { property: "og:url", content: canonical });
    upsertMeta('meta[property="og:site_name"]', { property: "og:site_name", content: "SocialBIRD" });
    upsertMeta('meta[property="og:locale"]', { property: "og:locale", content: "ru_RU" });
    upsertMeta('meta[name="twitter:card"]', { name: "twitter:card", content: "summary" });
    upsertMeta('meta[name="twitter:title"]', { name: "twitter:title", content: seo.title });
    upsertMeta('meta[name="twitter:description"]', { name: "twitter:description", content: seo.description });
    upsertLink("canonical", canonical);

    const schemaId = "socialbird-structured-data";
    let schema = document.getElementById(schemaId) as HTMLScriptElement | null;
    if (!schema) {
      schema = document.createElement("script");
      schema.id = schemaId;
      schema.type = "application/ld+json";
      document.head.appendChild(schema);
    }

    schema.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Organization",
          "@id": `${SITE_ORIGIN}/#organization`,
          name: "SocialBIRD",
          url: `${SITE_ORIGIN}/`,
          logo: `${SITE_ORIGIN}/favicon.ico`,
        },
        {
          "@type": "WebSite",
          "@id": `${SITE_ORIGIN}/#website`,
          name: "SocialBIRD",
          alternateName: "IT-BIRD SocialBIRD",
          url: `${SITE_ORIGIN}/`,
          inLanguage: ["ru", "en"],
          publisher: { "@id": `${SITE_ORIGIN}/#organization` },
        },
        {
          "@type": "WebApplication",
          name: "SocialBIRD",
          url: `${SITE_ORIGIN}/`,
          applicationCategory: "SocialNetworkingApplication",
          operatingSystem: "Web, Android",
          description:
            "Профессиональная социальная сеть для IT-специалистов с чатами, звонками, форумом, хакатонами и онлайн-компилятором.",
          publisher: { "@id": `${SITE_ORIGIN}/#organization` },
        },
      ],
    });
  }, [location.pathname]);

  return null;
};

export default SeoManager;
