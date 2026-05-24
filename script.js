document.addEventListener("DOMContentLoaded", function () {
  const form = document.querySelector("form");
  const locationInput = document.getElementById("location-input");
  const articlesList = document.getElementById("articles-list");
  const articleSheet = document.getElementById("article-sheet");
  const articleSheetTitle = document.getElementById("article-sheet-title");
  const articleSheetOpen = document.getElementById("article-sheet-open");
  const articleContent = document.getElementById("article-content");
  let map;
  let articleMarkers = L.layerGroup();
  let activeArticleRequest = 0;

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    const location = locationInput.value.trim();
    if (!location) {
      return;
    }

    articlesList.innerHTML = "<li>Searching...</li>";
    geocodeLocation(location);
  });

  function geocodeLocation(location) {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.search = new URLSearchParams({
      q: location,
      format: "jsonv2",
      limit: "1",
    });

    fetch(url)
      .then((response) => {
        if (!response.ok) {
          throw new Error("Unable to search for that location.");
        }

        return response.json();
      })
      .then((data) => {
        if (data.length > 0) {
          const lat = data[0].lat;
          const lon = data[0].lon;
          getArticles(lat, lon);
        } else {
          articlesList.innerHTML = "<li>Location not found</li>";
        }
      })
      .catch((error) => {
        articlesList.innerHTML = `<li>${error.message}</li>`;
      });
  }

  function getArticles(lat, lon) {
    const url = new URL("https://en.wikipedia.org/w/api.php");
    url.search = new URLSearchParams({
      action: "query",
      list: "geosearch",
      gsradius: "10000",
      gscoord: `${lat}|${lon}`,
      format: "json",
      origin: "*",
    });

    fetch(url)
      .then((response) => {
        if (!response.ok) {
          throw new Error("Unable to load Wikipedia articles.");
        }

        return response.json();
      })
      .then((data) => {
        articlesList.innerHTML = "";
        renderMap(lat, lon);

        if (
          data.query &&
          data.query.geosearch &&
          data.query.geosearch.length > 0
        ) {
          data.query.geosearch.forEach((item) => {
            const listItem = document.createElement("li");
            const link = document.createElement("a");
            link.href = getWikipediaUrl(item.title);
            link.dataset.articleTitle = item.title;
            link.textContent = item.title;
            listItem.appendChild(link);
            articlesList.appendChild(listItem);
            addMapPin(item.lat, item.lon, item.title);
          });
        } else {
          const listItem = document.createElement("li");
          listItem.textContent = "No articles found";
          articlesList.appendChild(listItem);
        }
      })
      .catch((error) => {
        articlesList.innerHTML = `<li>${error.message}</li>`;
      });
  }

  function renderMap(lat, lon) {
    const coords = [Number(lat), Number(lon)];

    if (!map) {
      map = L.map("map").setView(coords, 13);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
          'Map data © <a href="https://openstreetmap.org">OpenStreetMap</a> contributors',
        maxZoom: 18,
      }).addTo(map);
      articleMarkers.addTo(map);
    } else {
      map.setView(coords, 13);
      articleMarkers.clearLayers();
    }

    L.marker(coords).addTo(articleMarkers);
  }

  function addMapPin(lat, lon, title) {
    const popupContent = document.createElement("div");
    const popupTitle = document.createElement("strong");
    const viewButton = document.createElement("button");

    popupTitle.textContent = title;
    viewButton.type = "button";
    viewButton.className = "popup-view-button";
    viewButton.dataset.articleTitle = title;
    viewButton.textContent = "View Wikipedia";

    popupContent.appendChild(popupTitle);
    popupContent.appendChild(viewButton);

    L.marker([Number(lat), Number(lon)])
      .bindPopup(popupContent)
      .addTo(articleMarkers);
  }

  function getWikipediaUrl(title) {
    return `https://en.wikipedia.org/wiki/${encodeURIComponent(
      title.replaceAll(" ", "_")
    )}`;
  }

  function openArticle(title) {
    const articleUrl = getWikipediaUrl(title);
    const requestId = activeArticleRequest + 1;

    activeArticleRequest = requestId;

    articleSheetTitle.textContent = title;
    articleSheetOpen.href = articleUrl;
    articleContent.innerHTML = '<p class="article-status">Loading article...</p>';
    articleSheet.classList.add("is-open");
    articleSheet.setAttribute("aria-hidden", "false");
    document.body.classList.add("sheet-open");

    fetchArticle(title)
      .then((html) => {
        if (requestId !== activeArticleRequest) {
          return;
        }

        articleContent.replaceChildren(formatArticleHtml(html));
        articleContent.scrollTop = 0;
      })
      .catch(() => {
        if (requestId !== activeArticleRequest) {
          return;
        }

        articleContent.innerHTML =
          '<p class="article-status">This article could not be loaded here. Use Open to view it on Wikipedia.</p>';
      });
  }

  function closeArticle() {
    activeArticleRequest += 1;
    articleSheet.classList.remove("is-open");
    articleSheet.setAttribute("aria-hidden", "true");
    articleContent.replaceChildren();
    document.body.classList.remove("sheet-open");
  }

  function fetchArticle(title) {
    const url = new URL("https://en.wikipedia.org/w/api.php");
    url.search = new URLSearchParams({
      action: "parse",
      page: title,
      prop: "text",
      redirects: "1",
      disableeditsection: "1",
      format: "json",
      origin: "*",
    });

    return fetch(url)
      .then((response) => {
        if (!response.ok) {
          throw new Error("Unable to load the article.");
        }

        return response.json();
      })
      .then((data) => {
        if (!data.parse || !data.parse.text) {
          throw new Error("Article content was not returned.");
        }

        return data.parse.text["*"];
      });
  }

  function formatArticleHtml(html) {
    const template = document.createElement("template");

    template.innerHTML = html;
    template.content
      .querySelectorAll("script, style, .mw-editsection, .metadata")
      .forEach((element) => element.remove());
    template.content.querySelectorAll("a[href]").forEach((link) => {
      const href = link.getAttribute("href");

      if (href.startsWith("/wiki/")) {
        link.href = `https://en.wikipedia.org${href}`;

        if (!href.includes(":")) {
          link.dataset.articleTitle = decodeURIComponent(
            href.replace("/wiki/", "").replaceAll("_", " ")
          );
        }
      } else if (href.startsWith("//")) {
        link.href = `https:${href}`;
      }

      link.target = "_blank";
      link.rel = "noopener";
    });
    template.content.querySelectorAll("img").forEach((image) => {
      if (image.getAttribute("src")?.startsWith("//")) {
        image.src = `https:${image.getAttribute("src")}`;
      }

      image.removeAttribute("srcset");
      image.loading = "lazy";
    });

    const wrapper = document.createElement("div");
    wrapper.className = "article-content__body";
    wrapper.append(template.content);

    return wrapper;
  }

  document.addEventListener("click", function (event) {
    const articleTrigger = event.target.closest("[data-article-title]");

    if (articleTrigger) {
      event.preventDefault();
      openArticle(articleTrigger.dataset.articleTitle);
      return;
    }

    if (event.target.closest("[data-close-article]")) {
      closeArticle();
    }
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && articleSheet.classList.contains("is-open")) {
      closeArticle();
    }
  });
});
