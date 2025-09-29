"""
Flask app for a live data Movie Dashboard.
Provides backend routes for:
- Rendering the dashboard ("/")
- Fetching genres, movies, credits (REST API style)
Uses TMDB API with an API key stored in .env
"""

from flask import Flask, render_template, jsonify, request
from flask_cors import CORS
from dotenv import load_dotenv
from concurrent.futures import ThreadPoolExecutor, as_completed
import os
import requests

# Load environment variables from .env file
load_dotenv()

app = Flask(__name__)
CORS(app)  # Allow cross-origin requests (useful if we separate frontend)

TMDB_API_KEY = os.getenv("TMDB_API_KEY")
BASE_URL = "https://api.themoviedb.org/3"


def tmdb_get(url, params=None):
    """
    Helper function to call TMDb API safely.
    Returns parsed JSON on success, or None on failure.
    """
    if params is None:
        params = {}
    params["api_key"] = TMDB_API_KEY
    try:
        r = requests.get(url, params=params, timeout=10)
        r.raise_for_status()
        return r.json()
    except requests.RequestException:
        return None


@app.route("/")
def index():
    """
    Main route - renders dashboard template.
    If TMDB_API_KEY is missing, show helpful error page.
    """
    if not TMDB_API_KEY:
        return (
            "<h1>Configuration Error</h1>"
            "<p><strong>TMDB_API_KEY</strong> is not set.</p>"
            "<p>Create a <code>.env</code> file in the project root with:</p>"
            "<pre>TMDB_API_KEY=your_actual_tmdb_api_key</pre>",
            500,
        )
    return render_template("dashboard.html")


@app.route("/api/genres")
def api_genres():
    """
    Fetches list of genres from TMDb.
    Returns JSON {genres:[...]}.
    """
    if not TMDB_API_KEY:
        return jsonify({"error": "Missing API key"}), 500

    url = f"{BASE_URL}/genre/movie/list"
    data = tmdb_get(url, params={"language": "en-US"})
    if data is None:
        return jsonify({"error": "TMDb error"}), 500
    return jsonify(data)


@app.route("/api/movies")
def api_movies():
    """
    Fetch movies using either:
    - Discover API (filters: genre, year, min_score, runtime_min/max)
    - Search by title
    - Search by cast (via /search/person + their credits)
    Also supports pagination.
    Adds runtime to each movie result uusing parallel TMDb calls.
    """
    if not TMDB_API_KEY:
        return jsonify({"error": "Missing API key"}), 500

    # Query params
    genre = request.args.get("genre")
    year = request.args.get("year")
    min_score = request.args.get("min_score")
    runtime_min = request.args.get("runtime_min", type=int)
    runtime_max = request.args.get("runtime_max", type=int)
    page = int(request.args.get("page") or 1)
    search_type = request.args.get("search_type")
    query = request.args.get("query", "").strip()

    # Search by title
    if query and search_type == "title":
        url = f"{BASE_URL}/search/movie"
        params = {
            "language": "en-US",
            "query": query,
            "page": page,
            "include_adult": False,
        }
        data = tmdb_get(url, params=params)
        if data is None:
            return jsonify({"error": "TMDb error"}), 500
    # Search by cast/director
    elif query and search_type == "cast":
        # Search for person first
        person_search = tmdb_get(
            f"{BASE_URL}/search/person", params={"query": query, "page": 1}
        )
        if not person_search or not person_search.get("results"):
            # No person found, so return nothing
            return jsonify(
                {"results": [], "page": 1, "total_pages": 1, "total_results": 0}
            )

        # Use first matched person
        person = person_search["results"][0]
        person_id = person["id"]

        # Fetch person's movie credits
        credits = tmdb_get(
            f"{BASE_URL}/person/{person_id}/movie_credits", params={"language": "en-US"}
        )
        if credits is None:
            return jsonify({"error": "TMDb error"}), 500

        # credits has 'cast' list; return a simple paginated structure
        # (user expects results array)
        cast_results = credits.get("cast", [])
        # For compatibility with front-end, slice into pages
        per_page = 20
        start = (page - 1) * per_page
        end = start + per_page
        paged = cast_results[start:end]

        # Build a response object that mimics TMDb's search results format
        # so the frontend can paginate and render cast-based searches
        data = {
            "page": page,
            "results": paged,
            "total_results": len(cast_results),
            "total_pages": max(1, (len(cast_results) + per_page - 1) // per_page),
        }
    else:
        # Search movies with (combined) filters
        url = f"{BASE_URL}/discover/movie"
        params = {
            "language": "en-US",
            "sort_by": "popularity.desc",  # Sort by popularity by default
            "page": page,
            "include_adult": False,
            "include_video": False,
        }
        if genre:
            params["with_genres"] = genre
        if year:
            params["primary_release_year"] = year
        if min_score:
            params["vote_average.gte"] = min_score

        data = tmdb_get(url, params=params)
        if data is None:
            return jsonify({"error": "TMDb error"}), 500

    # Parallel runtime fetching
    # Fetch full runtimes for each movie concurrently since the discover/search
    # APIs do not include runtime data. This avoids blocking sequentially on
    # N requests, improving performance when displaying multiple movie cards.
    results = data.get("results", [])
    with ThreadPoolExecutor(max_workers=8) as executor:
        # Submit runtime fetch tasks for each movie ID
        futures = {executor.submit(fetch_runtime, m["id"]): m for m in results}
        for future in as_completed(futures):
            m = futures[future]
            try:
                # Attach runtime result to the corresponding movie dict
                m["runtime"] = future.result()
            except Exception:
                # Handle failures (e.g., network errors) by setting None
                m["runtime"] = None

    # Filter by runtime after fetching
    if runtime_min:
        results = [
            m
            for m in results
            if m["runtime"] is not None and m["runtime"] >= int(runtime_min)
        ]
    if runtime_max:
        results = [
            m
            for m in results
            if m["runtime"] is not None and m["runtime"] <= int(runtime_max)
        ]

    # Overwrite results with enriched movie data including runtimes
    data["results"] = results

    return jsonify(data)


@app.route("/api/movie/<int:movie_id>/credits")
def api_movie_credits(movie_id):
    """
    Fetch full cast + crew for a single movie.
    Used for modal view on frontend.
    """
    if not TMDB_API_KEY:
        return jsonify({"error": "Missing API key"}), 500
    url = f"{BASE_URL}/movie/{movie_id}/credits"
    data = tmdb_get(url, params={"language": "en-US"})
    if data is None:
        return jsonify({"error": "TMDb error"}), 500
    return jsonify(data)


def fetch_runtime(movie_id):
    """
    Fetch just the runtime for a single movie.
    """
    details = tmdb_get(f"{BASE_URL}/movie/{movie_id}", params={"language": "en-US"})
    return details.get("runtime") if details else None


if __name__ == "__main__":
    # Run in debug mode for local development
    app.run(debug=True)
