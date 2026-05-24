document.addEventListener("DOMContentLoaded", function () {
  const form = document.querySelector("form");
  const locationInput = document.getElementById("location-input");
  const locationSuggestions = document.getElementById("location-suggestions");
  const articlesList = document.getElementById("articles-list");
  const articleSheet = document.getElementById("article-sheet");
  const articleSheetTitle = document.getElementById("article-sheet-title");
  const articleSheetOpen = document.getElementById("article-sheet-open");
  const articleContent = document.getElementById("article-content");
  let map;
  let articleMarkers = L.layerGroup();
  let activeArticleRequest = 0;
  let searchHereButton;
  let suppressNextMovePrompt = false;
  let suggestionAbortController;
  let suggestionTimer;
  let currentSuggestions = [];
  let highlightedSuggestionIndex = -1;

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    const location = locationInput.value.trim();
    if (!location) {
      return;
    }

    articlesList.innerHTML = "<li>Searching...</li>";
    hideLocationSuggestions();
    geocodeLocation(location);
  });

  locationInput.addEventListener("input", function () {
    queueLocationSuggestions(locationInput.value.trim());
  });

  locationInput.addEventListener("keydown", function (event) {
    if (locationSuggestions.hidden || currentSuggestions.length === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedSuggestion(highlightedSuggestionIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedSuggestion(highlightedSuggestionIndex - 1);
    } else if (event.key === "Enter" && highlightedSuggestionIndex >= 0) {
      event.preventDefault();
      selectLocationSuggestion(currentSuggestions[highlightedSuggestionIndex]);
    } else if (event.key === "Escape") {
      hideLocationSuggestions();
    }
  });

  document.addEventListener("click", function (event) {
    if (!event.target.closest(".location-field")) {
      hideLocationSuggestions();
    }
  });

  function queueLocationSuggestions(query) {
    clearTimeout(suggestionTimer);

    if (query.length < 2) {
      abortSuggestionRequest();
      hideLocationSuggestions();
      return;
    }

    renderLocationSuggestionStatus("Searching...");
    suggestionTimer = setTimeout(() => fetchLocationSuggestions(query), 250);
  }

  function fetchLocationSuggestions(query) {
    abortSuggestionRequest();
    suggestionAbortController = new AbortController();

    const url = new URL("https://photon.komoot.io/api/");
    url.search = new URLSearchParams({
      q: query,
      limit: "6",
    });

    fetch(url, { signal: suggestionAbortController.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error("Unable to load suggestions.");
        }

        return response.json();
      })
      .then((data) => {
        if (locationInput.value.trim() !== query) {
          return;
        }

        renderLocationSuggestions(
          (data.features || []).map((feature) => ({
            display_name: formatPhotonSuggestion(feature.properties),
            lat: feature.geometry.coordinates[1],
            lon: feature.geometry.coordinates[0],
          })).filter((suggestion) => suggestion.display_name)
        );
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          renderLocationSuggestionStatus("Suggestions unavailable");
        }
      });
  }

  function formatPhotonSuggestion(properties) {
    return [
      properties.name,
      properties.city,
      properties.county,
      properties.state,
      properties.country,
    ]
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index)
      .join(", ");
  }

  function renderLocationSuggestionStatus(message) {
    currentSuggestions = [];
    highlightedSuggestionIndex = -1;
    locationSuggestions.replaceChildren();

    const item = document.createElement("li");
    item.className = "location-suggestion-status";
    item.textContent = message;
    locationSuggestions.appendChild(item);
    locationSuggestions.hidden = false;
    locationInput.setAttribute("aria-expanded", "true");
  }

  function renderLocationSuggestions(suggestions) {
    currentSuggestions = suggestions;
    highlightedSuggestionIndex = -1;
    locationSuggestions.replaceChildren();

    if (suggestions.length === 0) {
      renderLocationSuggestionStatus("No matches found");
      return;
    }

    suggestions.forEach((suggestion, index) => {
      const item = document.createElement("li");
      const button = document.createElement("button");

      item.role = "option";
      item.id = `location-suggestion-${index}`;
      button.type = "button";
      button.textContent = suggestion.display_name;
      button.addEventListener("click", function () {
        selectLocationSuggestion(suggestion);
      });

      item.appendChild(button);
      locationSuggestions.appendChild(item);
    });

    locationSuggestions.hidden = false;
    locationInput.setAttribute("aria-expanded", "true");
  }

  function setHighlightedSuggestion(nextIndex) {
    highlightedSuggestionIndex =
      (nextIndex + currentSuggestions.length) % currentSuggestions.length;

    locationSuggestions.querySelectorAll("li").forEach((item, index) => {
      const isHighlighted = index === highlightedSuggestionIndex;

      item.setAttribute("aria-selected", String(isHighlighted));
      item.classList.toggle("is-highlighted", isHighlighted);
    });
    locationInput.setAttribute(
      "aria-activedescendant",
      `location-suggestion-${highlightedSuggestionIndex}`
    );
  }

  function selectLocationSuggestion(suggestion) {
    locationInput.value = suggestion.display_name;
    hideLocationSuggestions();
    articlesList.innerHTML = "<li>Searching...</li>";
    getArticles(suggestion.lat, suggestion.lon, { updateMapView: true });
  }

  function hideLocationSuggestions() {
    currentSuggestions = [];
    highlightedSuggestionIndex = -1;
    locationSuggestions.hidden = true;
    locationSuggestions.replaceChildren();
    locationInput.setAttribute("aria-expanded", "false");
    locationInput.removeAttribute("aria-activedescendant");
  }

  function abortSuggestionRequest() {
    if (suggestionAbortController) {
      suggestionAbortController.abort();
      suggestionAbortController = null;
    }
  }

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
          getArticles(lat, lon, { updateMapView: true });
        } else {
          articlesList.innerHTML = "<li>Location not found</li>";
        }
      })
      .catch((error) => {
        articlesList.innerHTML = `<li>${error.message}</li>`;
      });
  }

  function getArticles(lat, lon, options = {}) {
    const updateMapView = options.updateMapView !== false;
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
        renderMap(lat, lon, { updateMapView });
        hideSearchHereButton();

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

  function renderMap(lat, lon, options = {}) {
    const updateMapView = options.updateMapView !== false;
    const coords = [Number(lat), Number(lon)];

    if (!map) {
      map = L.map("map").setView(coords, 13);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
          'Map data © <a href="https://openstreetmap.org">OpenStreetMap</a> contributors',
        maxZoom: 18,
      }).addTo(map);
      articleMarkers.addTo(map);
      addSearchHereControl();
      map.on("moveend", handleMapMoveEnd);
    } else {
      if (updateMapView) {
        const nextCenter = L.latLng(coords);
        const shouldMove =
          !map.getCenter().equals(nextCenter, 0.000001) || map.getZoom() !== 13;

        if (shouldMove) {
          suppressNextMovePrompt = true;
          map.setView(coords, 13);
        }
      }

      articleMarkers.clearLayers();
    }

    L.marker(coords).addTo(articleMarkers);
  }

  function addSearchHereControl() {
    const searchHereControl = L.control({ position: "topright" });

    searchHereControl.onAdd = function () {
      const container = L.DomUtil.create(
        "div",
        "leaflet-bar search-here-control"
      );
      searchHereButton = L.DomUtil.create(
        "button",
        "search-here-button",
        container
      );

      searchHereButton.type = "button";
      searchHereButton.textContent = "Search here";
      searchHereButton.hidden = true;
      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.on(searchHereButton, "click", searchCurrentMapView);

      return container;
    };

    searchHereControl.addTo(map);
  }

  function handleMapMoveEnd() {
    if (suppressNextMovePrompt) {
      suppressNextMovePrompt = false;
      return;
    }

    showSearchHereButton();
  }

  function showSearchHereButton() {
    if (searchHereButton) {
      searchHereButton.hidden = false;
    }
  }

  function hideSearchHereButton() {
    if (searchHereButton) {
      searchHereButton.hidden = true;
      searchHereButton.disabled = false;
      searchHereButton.textContent = "Search here";
    }
  }

  function searchCurrentMapView() {
    const center = map.getCenter();

    searchHereButton.disabled = true;
    searchHereButton.textContent = "Searching...";
    articlesList.innerHTML = "<li>Searching this map area...</li>";
    getArticles(center.lat, center.lng, { updateMapView: false });
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
