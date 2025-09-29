// Client-side logic: filters, search, pagination, modal, cast caching, night mode

// --- Domain Element References ---
const genreSelect = document.getElementById("genre-select");
const yearInput = document.getElementById("year-input");
const scoreSlider = document.getElementById("score-slider");
const scoreValue = document.getElementById("score-value");
const runtimeMin = document.getElementById("runtime-min");
const runtimeMax = document.getElementById("runtime-max");
const applyBtn = document.getElementById("apply-filters");
const clearBtn = document.getElementById("clear-filters");

const searchInput = document.getElementById("search-input");
const searchType = document.getElementById("search-type");
const searchButton = document.getElementById("search-button");

const movieList = document.getElementById("movie-list");
const showMoreBtn = document.getElementById("show-more");

const darkToggle = document.getElementById("dark-toggle");
const modalOverlay = document.getElementById("modal-overlay");
const modalClose = document.getElementById("modal-close");
const modalContent = document.getElementById("modal-content");

// --- State Variables ---
let currentPage = 1; // pagination tracker
let currentMode = "default"; // "default", "filtered", "search"
let lastQueryParams = {}; // used to keep state across Show More clicks
let castCache = new Map(); // client-side cache for credits

// --- Initialize UI ---
scoreValue.textContent = scoreSlider.value; // initialize score label
loadGenres().then(() => {
  // Load first page
  loadMovies({ page: 1 });
});

// --- Event Wiring ---
// Update live label when slider moves
scoreSlider.addEventListener("input", () => {
  scoreValue.textContent = scoreSlider.value;
});

// Apply filters button
applyBtn.addEventListener("click", () => {
  const params = {};
  if (genreSelect.value) params.genre = genreSelect.value;
  if (yearInput.value) params.year = yearInput.value;
  if (scoreSlider.value && Number(scoreSlider.value) > 0)
    params.min_score = scoreSlider.value;
  if (runtimeMin.value) params.runtime_min = runtimeMin.value;
  if (runtimeMax.value) params.runtime_max = runtimeMax.value;

  currentMode = "filtered";
  currentPage = 1;
  lastQueryParams = { ...params };
  loadMovies({ ...params, page: 1 });
});

// Clear filters button resets everything
clearBtn.addEventListener("click", () => {
  genreSelect.value = "";
  yearInput.value = "";
  scoreSlider.value = 0;
  scoreValue.textContent = "0";
  runtimeMin.value = "";
  runtimeMax.value = "";

  currentMode = "default";
  currentPage = 1;
  lastQueryParams = {};
  loadMovies({ page: 1 });
});

// Search bar (button + enter key)
// Also clears filters
searchButton.addEventListener("click", doSearch);
searchInput.addEventListener("keyup", (e) => {
  if (e.key === "Enter") doSearch();
});

function doSearch() {
  const q = searchInput.value.trim();
  if (!q) return;

  // Clear filters visually
  genreSelect.value = "";
  yearInput.value = "";
  scoreSlider.value = 0;
  scoreValue.textContent = "0";
  runtimeMin.value = "";
  runtimeMax.value = "";

  currentMode = "search";
  currentPage = 1;
  lastQueryParams = { query: q, search_type: searchType.value };
  loadMovies({ query: q, search_type: searchType.value, page: 1 });
}

// Show more button
showMoreBtn.addEventListener("click", () => {
  currentPage += 1;
  const params = { ...lastQueryParams, page: currentPage };
  loadMovies(params, { append: true });
});

// Modal close (click X, click outside, or Escape)
modalClose.addEventListener("click", closeModal);
modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

// Dark mode toggle + persistence
darkToggle.addEventListener("click", () => {
  document.body.classList.toggle("dark-mode");
  localStorage.setItem(
    "dark-mode",
    document.body.classList.contains("dark-mode")
  );
});
if (localStorage.getItem("dark-mode") === "true")
  document.body.classList.add("dark-mode");

// --- Functions ---
// Fetch genres from backend and populate dropdown
async function loadGenres() {
  try {
    const res = await fetch("/api/genres");
    const data = await res.json();
    const genres = data.genres || [];
    genres.forEach((g) => {
      const opt = document.createElement("option");
      opt.value = g.id;
      opt.textContent = g.name;
      genreSelect.appendChild(opt);
    });
  } catch (err) {
    console.error("Could not load genres", err);
  }
}

// Generic loader for movies
// params -> forwarded to backend as query string
// options.append = true -> append instead of replacing
async function loadMovies(params = {}, options = {}) {
  const qs = new URLSearchParams(params).toString();
  try {
    const res = await fetch(`/api/movies?${qs}`);
    const data = await res.json();
    const movies = data.results || [];

    if (options.append) {
      appendMovies(movies);
    } else {
      renderMovies(movies);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    // Show or hide "Show More" button
    const totalPages = data.total_pages || 1;
    showMoreBtn.style.display =
      (params.page || 1) < totalPages ? "inline-block" : "none";
  } catch (err) {
    console.error("loadMovies error", err);
  }
}

// Replace list contents
function renderMovies(movies) {
  movieList.innerHTML = "";
  appendMovies(movies);
}

// Append new movie cards to list
function appendMovies(movies) {
  movies.forEach((movie) => {
    const card = document.createElement("div");
    card.className = "movie-card";

    const posterPath = movie.poster_path
      ? `https://image.tmdb.org/t/p/w200${movie.poster_path}`
      : "";

    // Construct card with details + truncated description
    card.innerHTML = `
      <div class="card-left">
        ${
          posterPath
            ? `<img src="${posterPath}" alt="${escapeHtml(movie.title)}">`
            : `<div class="poster-placeholder"></div>`
        }
      </div>
      <div class="card-right">
        <h3>${escapeHtml(movie.title)}</h3>
        <p class="meta meta-top">
          ${movie.release_date || "N/A"}
          ${movie.runtime ? ` • ${movie.runtime} min` : ""}
        </p>
        <p class="meta meta-bottom">
          ⭐ ${Number(movie.vote_average).toFixed(2)} 
          (${movie.vote_count})
        </p>
        <p class="description">${escapeHtml(movie.overview)}</p>
      </div>
    `;

    // Make card clickable to open modal
    card.addEventListener("click", () => openMovieModal(movie.id, movie));

    movieList.appendChild(card);
  });
}

// Modal open with movie details + cast
async function openMovieModal(movieId, movieData) {
  try {
    let castData = castCache.get(movieId);
    if (!castData) {
      const res = await fetch(`/api/movie/${movieId}/credits`);
      castData = await res.json();
      castCache.set(movieId, castData);
    }

    const cast = (castData.cast || []).slice(0, 20);
    const crew = castData.crew || [];
    const directors = crew.filter((c) => c.job === "Director");

    modalContent.innerHTML = `
      <div class="modal-header">
        ${
          movieData.poster_path
            ? `<img src="https://image.tmdb.org/t/p/w300${
                movieData.poster_path
              }" alt="${escapeHtml(movieData.title)}">`
            : ""
        }
        <div class="modal-info">
          <h2>${escapeHtml(movieData.title)}</h2>
          <p>${movieData.release_date || "N/A"} • 
             ${movieData.runtime ? movieData.runtime + " min" : "?"} • 
             ${Number(movieData.vote_average).toFixed(2)} 
             (${movieData.vote_count ?? 0} votes)</p>
          <p>${movieData.overview || "No overview available."}</p>
        </div>
      </div>
      <h3>Cast</h3>
      <div class="cast-list">
        ${cast
          .map(
            (c) => `
          <div class="cast-member">
            ${
              c.profile_path
                ? `<img src="https://image.tmdb.org/t/p/w185${
                    c.profile_path
                  }" alt="${escapeHtml(c.name)}">`
                : `<div class="cast-placeholder"></div>`
            }
            <span>${c.name} as ${c.character}</span>
          </div>`
          )
          .join("")}
      </div>
      ${
        directors.length
          ? `<h4>Director(s)</h4><ul>${directors
              .map((d) => `<li>${d.name}</li>`)
              .join("")}</ul>`
          : ""
      }
    `;
    modalOverlay.classList.remove("hidden");
    modalOverlay.classList.add("show");
  } catch (err) {
    console.error("openMovieModal error", err);
  }
}

function closeModal() {
  modalOverlay.classList.remove("show");
  modalOverlay.classList.add("hidden");
}

// Escape HTML for security
function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/[&<>"']/g, function (m) {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[m];
  });
}
