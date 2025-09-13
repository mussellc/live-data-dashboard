// Client-side logic: filters, search, pagination, modal, cast caching, night mode

// --- Domain Element References ---
const genreSelect = document.getElementById("genre-select");
const yearSelect = document.getElementById("year-select");
const scoreSlider = document.getElementById("score-slider");
const scoreValue = document.getElementById("score-value");
const runtimeMin = document.getElementById("runtime-min");
const runtimeMax = document.getElementById("runtime-max");
const applyBtn = document.getElementById("apply-filters");
const clearBtn = document.getElementById("clear-filters");

const searchInput = document.getElementById("search-input");
const searchType = document.getElementById("search-type");
const searchButton = document.getElementById("search-button");

const movieGrid = document.getElementById("movie-grid");
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
populateYears(); // populate year dropdown
loadGenres().then(() => {
  // Load first page of popular movies
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
  if (yearSelect.value) params.year = yearSelect.value;
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
  yearSelect.value = "";
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
  yearSelect.value = "";
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

// Fill year dropdown from current year down to 1900
function populateYears() {
  const now = new Date().getFullYear();
  for (let y = now; y >= 1900; y--) {
    const opt = document.createElement("option");
    opt.value = y;
    opt.textContent = y;
    yearSelect.appendChild(opt);
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

    // Determine if more pages exist
    const totalPages = data.total_pages || 1;
    if ((params.page || 1) < totalPages) {
      showMoreBtn.style.display = "inline-block";
    } else {
      showMoreBtn.style.display = "none";
    }
  } catch (err) {
    console.error("loadMovies error", err);
  }
}

// Replace grid contents
function renderMovies(movies) {
  movieGrid.innerHTML = "";
  appendMovies(movies);
}

// Append new cards to grid
function appendMovies(movies) {
  movies.forEach((movie) => {
    const card = document.createElement("div");
    card.className = "movie-card";

    const posterPath = movie.poster_path
      ? `https://image.tmdb.org/t/p/w300${movie.poster_path}`
      : "";
    const genres = movie.genre_ids
      ? movie.genre_ids.map(idToGenreName).filter(Boolean).join(", ")
      : movie.genres
      ? movie.genres.map((g) => g.name).join(", ")
      : "";
    const release = movie.release_date || movie.first_air_date || "N/A";

    card.innerHTML = `
      ${
        posterPath
          ? `<img src="${posterPath}" alt="${escapeHtml(movie.title)}">`
          : `<div style="height:240px;background:#ddd;border-radius:8px"></div>`
      }
      <div style="display:flex;flex-direction:column;gap:6px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <strong style="font-size:14px">${escapeHtml(movie.title)}</strong>
          <span style="font-size:13px;color:var(--muted)">${
            movie.vote_average ?? "N/A"
          }</span>
        </div>
        <div class="movie-meta">
          <div><small>${genres}</small></div>
          <div><small>Release: ${release}</small></div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">
          <button class="btn view-cast" data-movie-id="${
            movie.id
          }">View Cast</button>
        </div>
      </div>
    `;
    movieGrid.appendChild(card);
  });

  // Attach click handler for each "View Cast" button
  document.querySelectorAll(".view-cast").forEach((btn) => {
    btn.onclick = async (e) => {
      const movieId = btn.getAttribute("data-movie-id");
      await openCastModal(movieId);
    };
  });
}

// Helper to map genre id -> name using loaded genreSelect options
function idToGenreName(id) {
  const opt = genreSelect.querySelector(`option[value="${id}"]`);
  return opt ? opt.textContent : null;
}

// Modal open for cast/crew
async function openCastModal(movieId) {
  try {
    // Try cache first
    let data = castCache.get(movieId);
    if (!data) {
      const res = await fetch(`/api/movie/${movieId}/credits`);
      data = await res.json();
      castCache.set(movieId, data);
    }

    const cast = (data.cast || []).slice(0, 12); // show top 12
    const crew = data.crew || [];
    const directors = crew.filter((c) => c.job === "Director");

    modalContent.innerHTML = `
      <h2>Cast</h2>
      <ul>${cast
        .map((c) => `<li>${c.name} as ${c.character}</li>`)
        .join("")}</ul>
      ${
        directors.length
          ? `<h3>Director(s)</h3><ul>${directors
              .map((d) => `<li>${d.name}</li>`)
              .join("")}</ul>`
          : ""
      }
    `;
    modalOverlay.classList.remove("hidden");
  } catch (err) {
    console.error("openCastModal error", err);
  }
}

function closeModal() {
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
