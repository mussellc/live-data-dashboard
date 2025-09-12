from flask import Flask, render_template, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
import os
import requests

# Load environment variables from .env
load_dotenv()

# Create Flask app
app = Flask(__name__)

# Enable CORS for all routes
CORS(app)

# Get API key from environment variables
TMDB_API_KEY = os.getenv("TMDB_API_KEY")

# Base URL for TMDB API
BASE_URL = "https://api.themoviedb.org/3"

# Function to fetch movie details
def get_movie_details(movie_id):
    """Fetch runtime and genres for a given movie ID"""
    details_url = f"{BASE_URL}/movie/{movie_id}?api_key={TMDB_API_KEY}&language=en-US"
    details_response = requests.get(details_url)

    if details_response.status_code == 200:
        return details_response.json()
    return {}

# Route for the dashboard
@app.route("/")
def dashboard():
    # Check if the API key is set
    if not TMDB_API_KEY:
        return (
            "<h1>Configuration Error</h1>"
            "<p><strong>TMDB_API_KEY</strong> is not set.</p>"
            "<p>Make sure you have a <code>.env</code> file in your project root with:</p>"
            "<pre>TMDB_API_KEY=your_actual_key_here</pre>",
            500
        )

    # Fetch the popular movies
    url = f"{BASE_URL}/movie/popular?api_key={TMDB_API_KEY}&language=en-US&page=1"
    response = requests.get(url)

    if response.status_code != 200:
        return f"API Error: {response.status_code}", 500

    movies = response.json().get("results", [])
    
    # Enrich the movies with runtime and genres
    enriched_movies = []
    for movie in movies:
        details = get_movie_details(movie["id"])
        genres = [g["name"] for g in details.get("genres", [])]
        runtime = details.get("runtime", None)
        
        enriched_movies.append({
            "title": movie["title"],
            "poster_path": movie["poster_path"],
            "vote_average": movie["vote_average"],
            "genres": genres,
            "runtime": runtime
        })

    return render_template("dashboard.html", movies=enriched_movies)

@app.route("/api/movies")
def api_movies():
    """API endpoint for JS fetch later"""
    return jsonify({"message": "This will return JSON movie data soon!"})

# Run the app
if __name__ == "__main__":
    app.run(debug=True)
