"""
Eric's Notes - Universal Bookmark Manager
A simple Flask backend for managing personal bookmarks with JSON file storage.
"""

import json
import os
from datetime import datetime, timezone
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

app = Flask(__name__, static_folder=".", static_url_path="")
CORS(app)

DATA_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bookmarks.json")

# Default categories with colors
DEFAULT_CATEGORIES = {
    "Claude": "#8B5CF6",
    "AI": "#3B82F6",
    "BI": "#10B981",
    "Azure": "#0078D4",
    "Local": "#F59E0B",
}


def load_bookmarks():
    """Load bookmarks from the JSON file."""
    if not os.path.exists(DATA_FILE):
        return {"bookmarks": [], "categories": DEFAULT_CATEGORIES}
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            if "categories" not in data:
                data["categories"] = DEFAULT_CATEGORIES
            return data
    except (json.JSONDecodeError, IOError):
        return {"bookmarks": [], "categories": DEFAULT_CATEGORIES}


def save_bookmarks(data):
    """Save bookmarks to the JSON file."""
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


# ---------- API Routes ----------


@app.route("/")
def index():
    """Serve the main page."""
    return send_from_directory(".", "index.html")


@app.route("/api/bookmarks", methods=["GET"])
def get_bookmarks():
    """Return all bookmarks, optionally filtered by category."""
    data = load_bookmarks()
    category = request.args.get("category")
    search = request.args.get("search", "").lower()

    bookmarks = data["bookmarks"]

    if category and category != "All":
        bookmarks = [b for b in bookmarks if b.get("category") == category]

    if search:
        bookmarks = [
            b for b in bookmarks
            if search in b.get("url", "").lower()
            or search in b.get("note", "").lower()
            or search in b.get("category", "").lower()
        ]

    return jsonify({"bookmarks": bookmarks, "categories": data["categories"]})


@app.route("/api/bookmarks", methods=["POST"])
def add_bookmark():
    """Add a new bookmark."""
    data = load_bookmarks()
    body = request.get_json()

    if not body or not body.get("url"):
        return jsonify({"error": "URL is required"}), 400

    url = body["url"].strip()
    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    bookmark = {
        "id": int(datetime.now(timezone.utc).timestamp() * 1000),
        "url": url,
        "note": body.get("note", "").strip(),
        "category": body.get("category", "Uncategorized"),
        "date_added": datetime.now(timezone.utc).isoformat(),
    }

    data["bookmarks"].insert(0, bookmark)
    save_bookmarks(data)
    return jsonify(bookmark), 201


@app.route("/api/bookmarks/<int:bookmark_id>", methods=["PUT"])
def update_bookmark(bookmark_id):
    """Update an existing bookmark."""
    data = load_bookmarks()
    body = request.get_json()

    for i, b in enumerate(data["bookmarks"]):
        if b["id"] == bookmark_id:
            if "url" in body:
                url = body["url"].strip()
                if not url.startswith(("http://", "https://")):
                    url = "https://" + url
                data["bookmarks"][i]["url"] = url
            if "note" in body:
                data["bookmarks"][i]["note"] = body["note"].strip()
            if "category" in body:
                data["bookmarks"][i]["category"] = body["category"]
            save_bookmarks(data)
            return jsonify(data["bookmarks"][i])

    return jsonify({"error": "Bookmark not found"}), 404


@app.route("/api/bookmarks/<int:bookmark_id>", methods=["DELETE"])
def delete_bookmark(bookmark_id):
    """Delete a bookmark."""
    data = load_bookmarks()
    original_len = len(data["bookmarks"])
    data["bookmarks"] = [b for b in data["bookmarks"] if b["id"] != bookmark_id]

    if len(data["bookmarks"]) == original_len:
        return jsonify({"error": "Bookmark not found"}), 404

    save_bookmarks(data)
    return jsonify({"success": True})


@app.route("/api/categories", methods=["GET"])
def get_categories():
    """Return all categories."""
    data = load_bookmarks()
    return jsonify(data["categories"])


@app.route("/api/categories", methods=["POST"])
def add_category():
    """Add a new category."""
    data = load_bookmarks()
    body = request.get_json()

    name = body.get("name", "").strip()
    color = body.get("color", "#6B7280")

    if not name:
        return jsonify({"error": "Category name is required"}), 400

    data["categories"][name] = color
    save_bookmarks(data)
    return jsonify(data["categories"])


if __name__ == "__main__":
    # Initialize data file if it doesn't exist
    if not os.path.exists(DATA_FILE):
        save_bookmarks({"bookmarks": [], "categories": DEFAULT_CATEGORIES})

    app.run(host="0.0.0.0", port=5001, debug=True)
